// PERSONA LAUNCH P4 — node-only unit harness: RINGS AND RING NOTES. No app server, no pinned port, no network: the
// lib/rings modules are bundled with esbuild (the @/ paths from tsconfig.json) with their stateful neighbours replaced by
// in-memory mocks (the vault, the keystore, the persona↔fid map, the root headshot, the chrome document, the anon list),
// and the REAL validator (validator/server.js createApp(":memory:"), which mounts validator/ringdrop.js) answers on an
// ephemeral loopback port. Every request is recorded; one that leaves for anything but that validator throws.
// Several DEVICES run in one process: their in-process caches (globalThis) are swapped in and out around every call.
//
//   node scripts/unit-rings.mjs            (npm run test:rings-unit once the verify agent adds the script)
//   RINGS_MUT=none node scripts/unit-rings.mjs   skip the mutation runs
//
// What it proves (DROP §12 U1-U13 adapted, plus the note):
//   E  the envelope: address round trip and tamper refusal; seal/open bit-exact; ONE ct length for 1 and 12 subjects;
//      an oversize statement refused, thumbnails dropped first; wrong PSK / other address / tampered ct, enc or hint
//      fail; dummies open under nothing and are byte-shaped like real rows; the /d link derives the same keys on both
//      sides; the statement validator's refusals
//   N  the note: real and random are both 512 hex and open under no wrong key; a real note copied onto another post
//      opens under nothing (the AAD); noteForPost throws on an unread document, is random without a "posts" ring, real
//      with one, and its real note names the persona's ref under the current key
//   F  the flow, several devices: a member sees "@persona · shared with you by <label>" on EXACTLY the posts of the
//      persona its ring holds at "posts" — not a sibling's, not a post made before it was shared, not another root's;
//      non-members (an ungranted address, no address) see nothing; every device reads the drop and the anon list on
//      every tick; FULL vs FAILED (500, cut-off, count mismatch, bad row, unreachable) hide without dropping and come
//      back with no new publish; missing-from-a-full-read drops; a re-served older generation never replaces a newer
//      one; revoke rotates the key (captured old keys open old notes and not new ones; a remaining member opens the
//      new ones after the next publish) and deletes the rows at once; a member added later never opens earlier posts;
//      lowering a ring's depth stops new posts; fid merges (main via rootHeadshot only; Totem's own fids never ride);
//      compartment mode and an unread chrome document hide every merge; the publisher swaps generations in one signed
//      request, keeps the old rows on a failed PUT, pads to buckets of 4 (1 → 4, 5 → 8); an unreadable root headshot
//      sends nothing; a linked device cannot hold an address; the first tick writes the document once (every device),
//      a member's ticks never write its vault; the hydrate's copy serves the composer with no request
//   W  the wave 2 review fixes: LP-2 two devices of one root (the twin's tick re-reads, so its notes and its publish follow
//      a revoke made elsewhere; a change in flight while the other device seals is refused; a real note from a stale
//      document is refused), LP-3 making an address sends and writes nothing (spares; a deferred upkeep at a random
//      moment keeps the claim), KEEP3 routine adds never cost a member a post it saw (chain steps), LP-5 no generation
//      numbers sealed, ONE-RING refused up front / skipped alone, UX-R1 "a friend" never the ring's own name, UX-R4
//      forgetting hides and "Use it again" restores
//   H  PERSONA LAUNCH GO-LIVE (UXH-9) hide, never delete: Remove and Delete ring KEEP the owner's records (hiddenAt),
//      still rotate and still delete the drop rows; a hidden record is sealed nothing, sent no key, not "seen" by the
//      composer and not counted toward 16 rings / 32 people; Restore is a JOIN (a new generation: the removed window
//      stays closed); the parser reads an old document as nothing hidden and refuses an unreadable mark; version 1
//      code refuses a version 2 document; the record bounds refuse a NEW ring or person in words and never a removal
//   V  the validator in process: unsigned refused, %4 refused, the signed positive control accepted; per-device
//      OCCUPANCY bounded (W2-RINGS-DROP-FILL-DOS)
//   S4 the UX seams from source (UX-R2 owner service, UX-R3 the address sentence, UX-R4 confirms, UX-L9 simulated chain)
//   S5 PERSONA LAUNCH wave 3 (final verify) — UXH-10 Delete ring reads the deletion's result (never "deleted" over a failed
//      one), UXH-15 the shown-once link has a Copy button that says when the browser refused, UXH-13 the /d card promises
//      nothing the link cannot do, L6 Remove and Delete say when the change reaches the root's other devices
//   L  the leak grep: no persona id, handle, ring or member label, address id, PSK, inbox material, note key or root
//      name in any request (outside the sealed ct), any validator table (outside ring_drop.ct / zk_anon_casts.note) or
//      the sealed vault bytes
//   R  the reset contract: arm, resetRingsCaches, read back empty; knownEmpty serves the composer at once
//   MUTATIONS: a broken copy of each guard must turn its check red (a short note, no AAD, no count check, no monotonic
//      seq, no rotation on revoke, no rotation on join, no compartment check, the validator without its %4 rule; and for
//      wave 2: no re-read adoption, no seal re-check, no composer age bound, an address written at the click, a fresh
//      chain per add, a gen sealed beside each key, one ring aborting the publish, no up-front size check, the ring's
//      own name sent, a forget that deletes, the validator without its occupancy rule, each UX seam undone).
import { createRequire } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-rings-unit-"));
// a patched VALIDATOR copy must resolve express & co. from the repo's node_modules: it lives under node_modules
const VCOPY_ROOT = path.join(ROOT, "node_modules", ".layers-unit-rings-" + process.pid);
process.on("exit", () => {
  rmSync(HERE, { recursive: true, force: true });
  rmSync(VCOPY_ROOT, { recursive: true, force: true });
});
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const RUN_MUTATIONS = process.env.RINGS_MUT !== "none";
for (const k of ["FC_TEST_FID", "FC_ANON_FID", "FC_RESERVED_FIDS", "RINGS_PUBLISH_MS", "ZK_MODE", "LAYERS_WORLD", "RING_DROP_MAX_ROWS", "RING_DROP_MAX_ROWS_PER_WRITE", "RING_DROP_WRITES_PER_HOUR"]) delete process.env[k];
// one loopback address makes every request: the validator's per-address bucket is raised for this LOCAL harness only
process.env.VALIDATOR_RL_CAPACITY = "1000000";
process.env.VALIDATOR_RL_REFILL_PER_SECOND = "100000";
process.env.VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY = "100000";
// PERSONA LAUNCH P4 (W2-RINGS-DROP-FILL-DOS): the drop's per-ADDRESS occupancy ceiling counts every device of this
// harness as one address, and SQL wipes between worlds never decrement it — raised for this LOCAL harness only (the
// per-address rule itself is proved in validator/test/ringdrop.test.js, one X-Forwarded-For per case)
process.env.RING_DROP_MAX_LIVE_PER_ADDRESS = "1000000";

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
    return String(threw.message ?? threw).slice(0, 110);
  });
}

// ------------------------------------------------------------------------------------------------ the validator
async function startValidator(serverJs) {
  const { createApp } = require(serverJs);
  const made = createApp(":memory:");
  const server = await new Promise((resolve) => {
    const s = made.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { db: made.db, server, base: "http://127.0.0.1:" + server.address().port };
}
const V = await startValidator(path.join(ROOT, "validator", "server.js"));

// ------------------------------------------------------------------------------------------------ devices
const te = new TextEncoder();
function edKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const edSignHex = (canonical, k) => edSign(null, Buffer.from(canonical, "utf8"), k.privateKey).toString("hex");
const GLOBAL_KEYS = ["__layersRings", "__layersRingsReceived", "__layersRingInbox", "__layersRingsPublish", "__layersRingsTicks", "__layersHydratedNs", "__layersHydratedNsAt", "__layersPersonaChrome", "__layersRingsTickChain"];

/** the harness control the mocks read (globalThis.__RU) */
const RU = {
  cur: null,
  vbase: V.base,
  anonCasts: [],
  anonListFails: false,
  anonReads: [],
  reservedFids: [],
  anonFid: null,
  dropMode: "ok",
  putFail: null,
  requests: [],
  vaultLog: [],
  async sign(dev, ns, body) {
    await registerDevice(dev, RU.vbase);
    dev.counter += 1;
    const bodyHash = createHash("sha256").update(body).digest("hex");
    return { "x-layers-device": dev.deviceId, "x-layers-counter": String(dev.counter), "x-layers-sig": edSignHex(["layers-envelope/1", ns, bodyHash, String(dev.counter)].join("|"), dev.devKey) };
  },
};
globalThis.__RU = RU;

async function registerDevice(dev, vbase) {
  if (dev.registeredAt === vbase) return;
  const realFetch = globalThis.__realFetch;
  const post = (p, body) => realFetch(vbase + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await post("/device/auth-anchor", { pubkey: dev.anchor.pubHex });
  const b = { v: 1, deviceId: dev.deviceId, devicePubKey: dev.devKey.pubHex, scopes: ["state-write"], issuedAt: Date.now(), expiresAt: null };
  const canon = ["layers-device-delegation/1", b.deviceId, b.devicePubKey, b.scopes.join(","), String(b.issuedAt), ""].join("|");
  const r = await post("/device/register", { delegation: { ...b, signature: edSignHex(canon, dev.anchor) }, anchorPubKey: dev.anchor.pubHex });
  if (r.status !== 201) throw new Error("harness: device registration refused " + r.status);
  dev.registeredAt = vbase;
}

let devSeq = 0;
function newDevice(name, opts = {}) {
  devSeq++;
  return {
    name,
    seed: new Uint8Array(randomBytes(32)),
    vaultKey: randomBytes(32),
    vault: new Map(),
    pins: new Set(),
    personas: opts.personas ?? [],
    fids: opts.fids ?? {},
    root: opts.root === undefined ? null : opts.root,
    linked: !!opts.linked,
    compartment: false,
    anchor: edKeys(),
    devKey: edKeys(),
    deviceId: "dev_rings_" + name + "_" + devSeq,
    counter: 1000,
    registeredAt: null,
    globals: {},
    failVaultRead: false,
    failVaultWrite: false,
    fidMapThrows: false,
  };
}
function use(dev) {
  if (RU.cur === dev) return;
  if (RU.cur) for (const k of GLOBAL_KEYS) RU.cur.globals[k] = globalThis[k];
  for (const k of GLOBAL_KEYS) {
    if (dev.globals[k] === undefined) delete globalThis[k];
    else globalThis[k] = dev.globals[k];
  }
  RU.cur = dev;
}
/** run fn AS a device (its caches swapped in) */
async function on(dev, fn) {
  use(dev);
  return fn();
}

// ------------------------------------------------------------------------------------------------ the recorder
const realFetch = globalThis.fetch;
globalThis.__realFetch = realFetch;
const jsonRes = (status, obj, raw) => new Response(raw ?? JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}) };
  RU.requests.push({ dev: RU.cur?.name ?? null, method, url: u, headers, body: typeof init.body === "string" ? init.body : "" });
  if (!u.startsWith(RU.vbase)) throw new Error("harness: a request left for " + u);
  const p = u.slice(RU.vbase.length);
  if (p === "/rings/drop" && method === "GET" && RU.dropMode !== "ok") {
    if (RU.dropMode === "throw") throw new TypeError("fetch failed (harness)");
    if (RU.dropMode === "500") return jsonRes(500, { error: "harness" });
    const real = await (await realFetch(u, init)).json();
    if (RU.dropMode === "truncated") return jsonRes(200, null, JSON.stringify(real).slice(0, 200));
    if (RU.dropMode === "count") return jsonRes(200, { ...real, count: real.count + 1 });
    if (RU.dropMode === "badrow") return jsonRes(200, { ...real, rows: [...real.rows.slice(1), { ...real.rows[0], ct: "zz" }] });
  }
  if (p === "/rings/drop/batch" && RU.putFail) return jsonRes(RU.putFail, { error: "harness refusal" });
  // refuse exactly the Nth drop write (400: the client does not retry a 4xx) — a publish whose later batch is refused
  if (p === "/rings/drop/batch" && method === "PUT" && RU.putFailNth) {
    RU.putSeen = (RU.putSeen ?? 0) + 1;
    if (RU.putSeen === RU.putFailNth) return jsonRes(400, { error: "harness refusal of write " + RU.putFailNth });
  }
  return realFetch(u, init);
};

// ------------------------------------------------------------------------------------------------ the mocks
const MOCKS = {
  "server-only": "export {};",
  "lib/ports": `export function validatorUrl() { return globalThis.__RU.vbase; } export function validatorPort() { return 0; }`,
  "lib/adapters/mock/persist": `
    const RU = () => globalThis.__RU;
    export function hydratedNamespace(ns) { const c = globalThis.__layersHydratedNs; return c ? c[ns] : undefined; }
    export function hydratedNamespaceAt(ns) { const c = globalThis.__layersHydratedNs; const a = globalThis.__layersHydratedNsAt; return c && c[ns] !== undefined && a ? a[ns] : undefined; }
    export function forgetHydratedNamespace(ns) { const c = globalThis.__layersHydratedNs; if (c) delete c[ns]; const a = globalThis.__layersHydratedNsAt; if (a) delete a[ns]; }
    export async function fetchState(ns) {
      const d = RU().cur;
      RU().vaultLog.push({ kind: "read", dev: d.name, ns });
      if (d.failVaultRead) return { status: 503, ok: false, json: async () => ({ error: "harness" }) };
      const e = d.vault.get(ns);
      return { status: 200, ok: true, json: async () => ({ entries: e ? JSON.parse(JSON.stringify(e)) : {} }) };
    }
    export async function flushVault(ns, entries) {
      const d = RU().cur;
      if (d.failVaultWrite) throw new Error('vault flush of "' + ns + '" failed (harness)');
      const text = JSON.stringify(entries);
      d.vault.set(ns, JSON.parse(text));
      RU().vaultLog.push({ kind: "write", dev: d.name, ns, bytes: text.length });
    }
    export async function deviceSignedWriteHeaders(ns, body) { return RU().sign(RU().cur, ns, body); }
    export async function signedWriteHeaders(ns, body) { return RU().sign(RU().cur, ns, body); }
    export async function signedReadHeaders() { return {}; }
  `,
  "lib/vault/vault": `
    import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
    const keyOf = (k) => Buffer.from(k ?? globalThis.__RU.cur.vaultKey);
    export function encryptNamespace(ns, plain, key) {
      const out = {};
      for (const [id, rec] of Object.entries(plain)) {
        const nonce = randomBytes(12);
        const c = createCipheriv("aes-256-gcm", keyOf(key), nonce);
        c.setAAD(Buffer.from(ns + "|" + id));
        const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(rec))), c.final(), c.getAuthTag()]);
        out[id] = { v: 1, ns, id, nonce: nonce.toString("hex"), ct: ct.toString("hex") };
      }
      return out;
    }
    export function decryptNamespace(ns, stored, key) {
      const out = {};
      let attempted = 0;
      for (const [id, rec] of Object.entries(stored)) {
        if (!rec || rec.v !== 1 || typeof rec.ct !== "string") continue;
        attempted++;
        if (rec.ns !== ns || rec.id !== id) continue;
        try {
          const buf = Buffer.from(rec.ct, "hex");
          const d = createDecipheriv("aes-256-gcm", keyOf(key), Buffer.from(rec.nonce, "hex"));
          d.setAAD(Buffer.from(ns + "|" + id));
          d.setAuthTag(buf.subarray(buf.length - 16));
          out[id] = JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString());
        } catch {}
      }
      if (attempted > 0 && Object.keys(out).length === 0) throw new Error('vault: all ' + attempted + ' ciphertext records in "' + ns + '" failed to decrypt');
      return out;
    }
  `,
  "lib/vault/sealedPins": `
    export function wasEverSealed(ns) { return globalThis.__RU.cur.pins.has(ns); }
    export function markEverSealed(ns) { globalThis.__RU.cur.pins.add(ns); }
  `,
  "lib/identity/keystore": `
    import { ringInboxSeed, ringPskSeed } from "@/lib/crypto/kdf";
    const cur = () => globalThis.__RU.cur;
    const hex = (u) => Buffer.from(u).toString("hex");
    export function isLinkedDevice() { return !!cur().linked; }
    export function ringInboxMaterial(nonce) {
      if (cur().linked) throw new Error("keystore: this device holds a LINKED root and no seed — that operation needs a device that holds the root");
      return { ikm: ringInboxSeed(cur().seed, nonce), psk: ringPskSeed(cur().seed, nonce) };
    }
    export function ringMaterialForLeakTest(nonces) { const out = []; for (const n of nonces) { const m = ringInboxMaterial(n); out.push(hex(m.ikm), hex(m.psk)); } return out; }
    export function listPersonas() { return cur().personas.map((p) => ({ ...p })); }
  `,
  "lib/fc/personaFid": `
    const cur = () => globalThis.__RU.cur;
    export async function personaFidMap() { if (cur().fidMapThrows) throw new Error("vault: personaFids unreadable (harness)"); return { ...cur().fids }; }
    export function ownAccountFids(records, anonFid) { const s = new Set(globalThis.__RU.reservedFids); if (anonFid) s.add(anonFid); return s; }
    export async function anonAccountFid() { return globalThis.__RU.anonFid; }
  `,
  "lib/identity/rootHeadshot": `
    export async function rootHeadshot() { const d = globalThis.__RU.cur; if (d.root === "throw") throw new Error("accountLinks unreadable (harness)"); return d.root; }
  `,
  "lib/identity/chrome": `
    export async function viewScope(active, ids) {
      const d = globalThis.__RU.cur;
      if (d.chromeUnreadable) throw new Error("persona chrome unavailable (harness)");
      globalThis.__layersPersonaChrome = { tints: {}, unified: false, compartment: !!d.compartment, loaded: true };
      return { unified: false, unifiedRequested: false, compartment: !!d.compartment, activePersonaId: active, visiblePersonaIds: ids, reason: "single" };
    }
    export async function visibleOwnPersonaIds() { return globalThis.__RU.cur.personas.map((p) => p.id); }
  `,
  "lib/zk/validatorClient": `
    export async function fetchAnonCasts(mode) {
      const RU = globalThis.__RU;
      RU.anonReads.push({ dev: RU.cur ? RU.cur.name : null, mode });
      if (RU.anonListFails) throw new Error("zk validator refused /zk/anon-casts: HTTP 503");
      return RU.anonCasts.filter((c) => c.mode === mode).map((c) => ({ ...c }));
    }
  `,
};

// ------------------------------------------------------------------------------------------------ the bundler
let bundleSeq = 0;
async function bundle(patches = {}) {
  const dir = path.join(HERE, "b" + ++bundleSeq);
  mkdirSync(dir, { recursive: true });
  const mockFile = {};
  for (const [k, src] of Object.entries(MOCKS)) {
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
    name: "rings-mocks",
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
  writeFileSync(
    entry,
    `export * as envelope from "@/lib/rings/envelope";
export * as note from "@/lib/rings/note";
export * as model from "@/lib/rings/model";
export * as inbox from "@/lib/rings/inbox";
export * as outbound from "@/lib/rings/outbound";
export * as publisher from "@/lib/rings/publisher";
export * as received from "@/lib/rings/received";
export * as fetchm from "@/lib/rings/fetch";
export * as tick from "@/lib/rings/tick";
export * as merge from "@/lib/rings/merge";
`
  );
  const out = path.join(dir, "out.mjs");
  await build({ absWorkingDir: ROOT, entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node", target: ["node20"], tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [plugin], loader: { ".json": "json" }, logLevel: "error" });
  return import(pathToFileURL(out).href);
}

// ------------------------------------------------------------------------------------------------ helpers
const hex = (n) => randomBytes(n).toString("hex");
const hourNow = () => Math.floor(Date.now() / 3_600_000);
const ROOT_FACE = { source: "farcaster", fname: "rootyfname", displayName: "Rooty Root", pfpUrl: "https://pfp.example.invalid/rooty.png" };
const INLINE_PFP = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'%3E%3Crect width='4' height='4' fill='%23336'/%3E%3C/svg%3E";
let worldSeq = 0;
/** a fresh world: an owner (three public personas, a private one and the public self) and four other devices */
function world() {
  worldSeq++;
  const w = "w" + worldSeq;
  const owner = newDevice("owner" + w, {
    root: ROOT_FACE,
    personas: [
      { id: "p_alice_" + w, kind: "public", handle: "alicepersona" + w, name: "Alice Persona", avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=alice" },
      { id: "p_bob_" + w, kind: "public", handle: "bobpersona" + w, name: "Bob Persona", avatarUrl: INLINE_PFP },
      { id: "p_carol_" + w, kind: "public", handle: "carolpersona" + w, name: "Carol Persona", avatarUrl: null },
      { id: "p_test_" + w, kind: "public", handle: "testacctpersona" + w, name: "On the test account", avatarUrl: null },
      { id: "p_priv_" + w, kind: "private", handle: "privpersona" + w, name: "Private Persona", avatarUrl: null },
      { id: "p_self_" + w, kind: "public", handle: "selfpersona" + w, name: "Me On Farcaster", avatarUrl: null, publicSelf: true },
    ],
    fids: { ["p_carol_" + w]: { fid: 424242, fname: "carolfc" }, ["p_test_" + w]: { fid: 9152, fname: "testshared" } },
  });
  return { w, owner, A: owner.personas[0], B: owner.personas[1], C: owner.personas[2], T: owner.personas[3], P: owner.personas[4], S: owner.personas[5], m1: newDevice("m1" + w), m2: newDevice("m2" + w), n1: newDevice("n1" + w), n2: newDevice("n2" + w) };
}
function castHashOf(text) {
  return createHash("sha256").update("layers-anon-cast/1|" + hex(16) + "|" + text).digest("hex");
}
/** an anon post as the composer makes it: the note from noteForPost on the owner device, then the row the validator serves */
async function anonPost(R, owner, persona, text) {
  const castHash = castHashOf(text);
  const n = await on(owner, () => R.note.noteForPost("fixture", persona.id, castHash));
  RU.anonCasts.push({ mode: "fixture", castHash, hash: "0x" + castHash.slice(0, 40), text, at: Date.now(), fid: 1, note: n });
  return { castHash, note: n };
}
const tickOn = (R, dev) => on(dev, () => R.tick.ringsTick("fixture"));
const reveal = (R, dev, castHash) => on(dev, () => R.merge.ringRevealForAnon(castHash, "fixture"));
const dropRows = () => V.db.prepare("SELECT * FROM ring_drop").all();
async function address(R, dev) {
  return on(dev, () => R.inbox.createAddress(null));
}

// ================================================================================================ the bundle
const R = await bundle();
console.log("\nPERSONA LAUNCH P4 — rings and ring notes (unit, node-only, validator in process at " + V.base + ")");

// ================================================================================================ E — the envelope
console.log("\nE — the envelope");
await check("E1 address: inbox keys → LR1 address → parse gives the same address id, public key and PSK; a changed character, a cut paste and another prefix are refused in plain words", async () => {
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const a = R.envelope.addressString(k);
  assert(a.startsWith("LR1.") && a.length === 4 + 107, "address shape " + a.length);
  const p = R.envelope.parseAddress("  " + a + "\n");
  assert(p.ok && p.addrId === k.addrId && p.pkHex === k.pkHex && p.pskHex === k.pskHex, "round trip");
  const flip = a.slice(0, 30) + (a[30] === "A" ? "B" : "A") + a.slice(31);
  assert(!R.envelope.parseAddress(flip).ok, "a changed character was accepted");
  assert(!R.envelope.parseAddress(a.slice(0, 80)).ok, "a cut paste was accepted");
  assert(!R.envelope.parseAddress("LD1." + a.slice(4)).ok, "another prefix was accepted");
  return "107-char body";
});
function statement(addrId, extra = {}) {
  const now = Date.now();
  return { v: 1, addrId, rid: hex(8), seq: now, issuedAt: now, expiresAt: now + 72 * 3_600_000, label: "Inner", root: { fname: "rootyfname", displayName: "Rooty Root" }, subjects: [{ ref: hex(8), handle: "alicepersona", display: "Alice", kind: "persona", depth: "posts", noteKeys: [{ keyHex: hex(32), n: 4 }] }], ...extra };
}
await check("E2 seal → open is bit-exact (U1, without the drop); the opened statement validates", async () => {
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const s = statement(k.addrId);
  const sealed = await R.envelope.sealStatement(s, k);
  const opened = await R.envelope.openRow(sealed, k, Date.now());
  assert(opened && JSON.stringify(opened) === JSON.stringify(s), "the statement did not round-trip bit-exact");
});
await check("E3 ONE ct length (8224 hex) for 1 subject and for 12; a statement over 4096 bytes is REFUSED at seal; thumbnails are dropped first (sealed without them)", async () => {
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const one = await R.envelope.sealStatement(statement(k.addrId), k);
  const subj = (i, keys) => ({ ref: hex(8), handle: "persona" + i, display: "Persona " + i, kind: "persona", depth: "posts", noteKeys: Array.from({ length: keys }, () => ({ keyHex: hex(32), n: 32 })) });
  const twelve = await R.envelope.sealStatement(statement(k.addrId, { subjects: Array.from({ length: 12 }, (_, i) => subj(i, 1)) }), k);
  assert(one.ct.length === 8224 && twelve.ct.length === 8224 && one.enc.length === 64 && twelve.enc.length === 64, `lengths ${one.ct.length} ${twelve.ct.length}`);
  let refused = null;
  try {
    await R.envelope.sealStatement(statement(k.addrId, { subjects: Array.from({ length: 16 }, (_, i) => subj(i, 3)) }), k);
  } catch (e) {
    refused = e;
  }
  assert(refused && refused.name === "RingStatementTooLarge", "an oversize statement was not refused: " + refused);
  const thumbed = statement(k.addrId, { root: { fname: "rootyfname", displayName: "Rooty Root", thumb: "data:image/png;base64," + "A".repeat(1150) }, subjects: Array.from({ length: 6 }, (_, i) => ({ ...subj(i, 1), thumb: "data:image/png;base64," + "B".repeat(1150) })) });
  const sealed = await R.envelope.sealStatement(thumbed, k);
  assert(sealed.thumbsDropped === true, "thumbnails were not dropped");
  const opened = await R.envelope.openRow(sealed, k, Date.now());
  assert(opened && !opened.root.thumb && opened.subjects.every((x) => !x.thumb) && opened.subjects.length === 6, "the sealed statement still carries a thumbnail or lost a subject");
  return "a 16-subject statement refused";
});
await check("E4 U3: a wrong PSK, another address holding the SAME PSK, a tampered ct, a tampered enc and a tampered hint all fail to open", async () => {
  const psk = new Uint8Array(randomBytes(32));
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), psk);
  const other = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), psk);
  const s = await R.envelope.sealStatement(statement(k.addrId), k);
  const now = Date.now();
  assert((await R.envelope.openRow(s, k, now)) !== null, "positive control");
  assert((await R.envelope.openRow(s, { ...k, pskHex: hex(32) }, now)) === null, "a wrong PSK opened it");
  assert((await R.envelope.openRow(s, other, now)) === null, "another address with the same PSK opened it");
  const flipHex = (h, i) => h.slice(0, i) + (h[i] === "0" ? "1" : "0") + h.slice(i + 1);
  assert((await R.envelope.openRow({ ...s, ct: flipHex(s.ct, 500) }, k, now)) === null, "a tampered ct opened");
  assert((await R.envelope.openRow({ ...s, enc: flipHex(s.enc, 10) }, k, now)) === null, "a tampered enc opened");
  assert((await R.envelope.openRow({ ...s, hint: flipHex(s.hint, 0) }, k, now)) === null, "a tampered hint opened");
});
await check("E5 U4: dummies open under no address and are byte-shaped like real rows (lengths, charset)", async () => {
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const real = await R.envelope.sealStatement(statement(k.addrId), k);
  for (let i = 0; i < 40; i++) {
    const d = await R.envelope.dummyRowParts();
    assert(d.enc.length === real.enc.length && d.ct.length === real.ct.length && d.hint.length === real.hint.length, "a dummy has another shape");
    assert(/^[0-9a-f]+$/.test(d.enc + d.ct + d.hint), "a dummy is not hex");
    assert((await R.envelope.openRow(d, k, Date.now())) === null, "a dummy opened");
  }
  return "40 dummies";
});
await check("E6 U12: the /d link — the owner's makeLink keys and the card's linkInboxKey derive the SAME address id and PSK, and the card opens what the owner sealed", async () => {
  const keyHex = hex(32);
  const a = await R.envelope.linkInboxKey(keyHex);
  const b = await R.envelope.linkInboxKey(keyHex);
  assert(a.addrId === b.addrId && a.pskHex === b.pskHex && a.pkHex === b.pkHex, "the two sides derive different keys");
  const s = await R.envelope.sealStatement(statement(a.addrId), a);
  assert((await R.envelope.openRow(s, b, Date.now())) !== null, "the card could not open it");
  let threw = false;
  try {
    await R.envelope.linkInboxKey("abc");
  } catch {
    threw = true;
  }
  assert(threw, "an incomplete link key was accepted");
});
await check("E7 the statement validator refuses: a lease over 72 h, an expired note, one issued in the future, another address, a URL as a thumbnail, note keys on a name-only subject, a note key carrying a generation number (LP-5), a step count over the chain", async () => {
  const addr = hex(16);
  const now = Date.now();
  const v = (x) => R.envelope.validateStatement(x, addr, now);
  assert(v(statement(addr)).ok, "positive control");
  assert(v(statement(addr, { expiresAt: now + 72 * 3_600_000 })).ok, "positive control: a 72-hour lease");
  assert(!v(statement(addr, { expiresAt: now + 73 * 3_600_000 })).ok, "lease > 72 h");
  assert(!v(statement(addr, { expiresAt: now - 1 })).ok, "expired");
  assert(!v(statement(addr, { issuedAt: now + 10 * 60_000 })).ok, "future");
  assert(!v(statement(hex(16))).ok, "another address");
  assert(!v(statement(addr, { root: { fname: "x", displayName: null, thumb: "https://example.invalid/a.png" } })).ok, "a URL thumbnail");
  assert(!v(statement(addr, { subjects: [{ ref: hex(8), handle: "a", display: "A", kind: "persona", depth: "name", noteKeys: [{ keyHex: hex(32), n: 4 }] }] })).ok, "note keys at depth name");
  const sub = (k) => statement(addr, { subjects: [{ ref: hex(8), handle: "a", display: "A", kind: "persona", depth: "posts", noteKeys: [k] }] });
  assert(v(sub({ keyHex: hex(32), n: 32 })).ok, "positive control: a 32-step stretch");
  assert(!v(sub({ keyHex: hex(32), n: 4, gen: 3 })).ok, "a note key carrying a generation number (LP-5)");
  assert(!v(sub({ keyHex: hex(32), n: 33 })).ok, "a stretch longer than a chain");
  assert(!v(sub({ keyHex: hex(32), n: 0 })).ok, "a stretch of zero keys");
});

await check("E8 U1 THROUGH THE REAL DROP: seal → a signed PUT (padded to 4) → the plain GET → hint match → open → the statement round-trips bit-exact; the dummies beside it open under nothing", async () => {
  const dev = newDevice("u1");
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const s = statement(k.addrId);
  const sealed = await R.envelope.sealStatement(s, k);
  const row = (parts) => ({ id: R.envelope.newRowId(), enc: parts.enc, ct: parts.ct, hint: parts.hint, expiresHour: hourNow() + 2, delHash: R.envelope.delHashOf(R.envelope.newToken()) });
  const rows = [row(sealed), row(await R.envelope.dummyRowParts()), row(await R.envelope.dummyRowParts()), row(await R.envelope.dummyRowParts())];
  const put = await on(dev, () => R.publisher.putDropBatch(rows, []));
  assert(put.ok, "the signed PUT: " + JSON.stringify(put));
  const got = await on(dev, () => R.fetchm.fetchRingDrop());
  assert(got.full, "the GET was not FULL: " + JSON.stringify(got).slice(0, 200));
  let opened = 0;
  let exact = false;
  for (const r of got.rows) {
    const st = await R.envelope.openRow(r, k, Date.now());
    if (st) {
      opened++;
      exact = JSON.stringify(st) === JSON.stringify(s);
    }
  }
  assert(opened === 1 && exact, `opened ${opened} rows, bit-exact ${exact}`);
});

// ================================================================================================ N — the note
console.log("\nN — the ring note");
async function noteSizeCheck(Rx) {
  const key = hex(32);
  const ch = hex(32);
  const real = Rx.note.sealNote(key, hex(8), ch);
  const rnd = Rx.note.randomNote();
  assert(real.length === 512 && rnd.length === 512, `a note is not 512 hex: real ${real.length}, random ${rnd.length}`);
  assert(Rx.note.NOTE_RE.test(real) && Rx.note.NOTE_RE.test(rnd), "a note is not 512 lowercase hex");
  for (let i = 0; i < 20; i++) {
    const wrong = hex(32);
    assert(Rx.note.openNoteWith(real, ch, wrong) === null && Rx.note.openNoteWith(rnd, ch, wrong) === null, "a wrong key opened a note");
  }
  assert(Rx.note.openNoteWith(real, ch, key) !== null, "positive control: the real note opens with its key");
}
await check("N1 real and random notes are both 256 bytes (512 hex) and open under no wrong key; the real one opens with its key (positive control)", () => noteSizeCheck(R));
async function noteAadCheck(Rx) {
  const key = hex(32);
  const ref = hex(8);
  const a = hex(32);
  const b = hex(32);
  const n = Rx.note.sealNote(key, ref, a);
  assert(Rx.note.openNoteWith(n, a, key) === ref, "positive control: opens on its own post");
  assert(Rx.note.openNoteWith(n, b, key) === null, "a real note copied onto ANOTHER post opened");
  assert(Rx.note.openNote(n, b, [hex(32), key]) === null, "openNote opened it on another post");
}
await check("N2 a real note copied onto another post's cast hash opens under NO key (the AAD binds the post)", () => noteAadCheck(R));
await check("N3 noteForPost: THROWS on an unread rings document (never random-as-a-guess); random without a ring at 'posts'; real with one, naming the persona's ref under the current key; always 512 hex", async () => {
  const W = world();
  let threw = null;
  await on(W.owner, async () => {
    R.model.resetRingsDocCache();
    try {
      await R.note.noteForPost("fixture", W.A.id, hex(32));
    } catch (e) {
      threw = e;
    }
  });
  assert(threw && /haven't been read|couldn't read/.test(threw.message), "an unread document did not throw: " + threw);
  await on(W.owner, () => R.model.loadRingsDoc());
  const ch = hex(32);
  const none = await on(W.owner, () => R.note.noteForPost("fixture", W.A.id, ch));
  assert(none.length === 512, "random note length");
  const { id } = await on(W.owner, () => R.outbound.createRing("Inner"));
  await on(W.owner, () => R.outbound.setDepth(id, W.A.id, "posts"));
  const real = await on(W.owner, () => R.note.noteForPost("fixture", W.A.id, ch));
  const k = await on(W.owner, () => R.model.noteKeyForPost(W.A.id));
  assert(real.length === 512 && R.note.openNoteWith(real, ch, k.keyHex) === k.ref, "the real note does not name the persona's ref under the current key");
  assert(R.note.openNoteWith(none, ch, k.keyHex) === null, "the earlier random note opens");
  const sib = await on(W.owner, () => R.note.noteForPost("fixture", W.B.id, ch));
  assert(R.note.openNoteWith(sib, ch, k.keyHex) === null, "a sibling's note opens under this persona's key");
});

// ================================================================================================ F — the flow
console.log("\nF — the flow, several devices, the real drop");
V.db.exec("DELETE FROM ring_drop");
const W = world();
let ringId = null;
const posts = {};
const memberIds = {};
const flowFrom = RU.requests.length;
await check("F1 setup: the owner makes a ring 'Inner', shares @alice at 'posts' and @bob at 'name'; m1 and m2 hand over addresses; n1 has an address nobody granted; n2 has none. A post made BEFORE the share carries a random note", async () => {
  // every device ticks first (as every device does on its schedule): the owner's composer path then has its document
  for (const d of [W.owner, W.m1, W.m2, W.n1, W.n2]) await tickOn(R, d);
  posts.before = await anonPost(R, W.owner, W.A, "before the share");
  const a1 = await address(R, W.m1);
  const a2 = await address(R, W.m2);
  await address(R, W.n1);
  ringId = (await on(W.owner, () => R.outbound.createRing("Inner"))).id;
  memberIds.m1 = (await on(W.owner, () => R.outbound.addMember(ringId, a1.address, "Mia"))).memberId;
  memberIds.m2 = (await on(W.owner, () => R.outbound.addMember(ringId, a2.address, "Max"))).memberId;
  await on(W.owner, () => R.outbound.setDepth(ringId, W.A.id, "posts"));
  await on(W.owner, () => R.outbound.setDepth(ringId, W.B.id, "name"));
  const k = await on(W.owner, () => R.model.noteKeyForPost(W.A.id));
  assert(R.note.openNoteWith(posts.before.note, posts.before.castHash, k.keyHex) === null, "the pre-share note opens");
  assert((await on(W.owner, () => R.model.noteKeyForPost(W.B.id))) === null, "a name-only persona gets a note key");
});
let firstGen = null;
await check("F2 publish: one signed request, rows a multiple of 4 (2 members → 4), the ct the fixed size, the GET serves exactly five fields per row", async () => {
  const before = RU.requests.length;
  const r = await on(W.owner, () => R.publisher.publishOnce({ force: true }));
  assert(r.ok && r.rows === 4 && r.real === 2, "publish: " + JSON.stringify(r));
  const puts = RU.requests.slice(before).filter((x) => x.method === "PUT");
  assert(puts.length === 1 && puts[0].headers["x-layers-sig"] && puts[0].headers["x-layers-device"], "not ONE signed PUT");
  const rows = dropRows();
  assert(rows.length === 4 && rows.every((x) => x.ct.length === 8224), "the drop holds " + rows.length);
  const g = await (await realFetch(V.base + "/rings/drop")).json();
  assert(g.rows.every((x) => Object.keys(x).sort().join() === "ct,enc,expiresHour,hint,id"), "a served row has other fields");
  firstGen = rows.map((x) => ({ ...x }));
});
await check("F3 posts after the share: @alice's carries a REAL note, @bob's (name only) and the before-post a random one — all 512 hex", async () => {
  posts.alice = await anonPost(R, W.owner, W.A, "alice after the share");
  posts.bob = await anonPost(R, W.owner, W.B, "bob, a sibling at name depth");
  const k = await on(W.owner, () => R.model.noteKeyForPost(W.A.id));
  assert(R.note.openNoteWith(posts.alice.note, posts.alice.castHash, k.keyHex) !== null, "alice's note is not real");
  assert([posts.before, posts.alice, posts.bob].every((p) => p.note.length === 512), "a note length differs");
});
await check("F4 THE MEMBERS SEE EXACTLY THE SHARED POSTS: m1 and m2 show '@alice · shared with you by Rooty Root' on alice's post and NOTHING on the pre-share post or the sibling's; n1 (ungranted address) and n2 (no address) see nothing at all", async () => {
  for (const d of [W.m1, W.m2, W.n1, W.n2]) await tickOn(R, d);
  for (const d of [W.m1, W.m2]) {
    const r = await reveal(R, d, posts.alice.castHash);
    assert(r && r.persona.handle === W.A.handle && r.label === "Rooty Root" && r.root.fname === "rootyfname", d.name + ": " + JSON.stringify(r));
    assert(r.persona.thumb === null && r.root.thumb === null, "a URL avatar became a thumbnail");
    assert((await reveal(R, d, posts.before.castHash)) === null, d.name + " sees the pre-share post");
    assert((await reveal(R, d, posts.bob.castHash)) === null, d.name + " sees the sibling's post");
  }
  for (const d of [W.n1, W.n2]) for (const p of Object.values(posts)) assert((await reveal(R, d, p.castHash)) === null, d.name + " (not a member) sees a post");
  const st = await on(W.m1, () => R.received.receivedStatus());
  assert(st.rings.length === 1 && st.rings[0].state === "shown" && st.rings[0].personas.map((p) => p.handle).sort().join() === [W.A.handle, W.B.handle].sort().join(), "m1's status: " + JSON.stringify(st));
});
await check("F5 EVERY device reads the drop AND the anon list on EVERY tick, rings or not (one plain unsigned GET each), and no device but the owner wrote to the drop", async () => {
  const from = RU.requests.length;
  const fromAnon = RU.anonReads.length;
  for (const d of [W.m1, W.n1, W.n2, W.owner]) await tickOn(R, d);
  for (const d of [W.m1, W.n1, W.n2, W.owner]) {
    const gets = RU.requests.slice(from).filter((x) => x.dev === d.name && x.method === "GET" && x.url === V.base + "/rings/drop");
    assert(gets.length === 1, d.name + " made " + gets.length + " drop reads in one tick");
    assert(!gets[0].headers["x-layers-device"] && !gets[0].headers["x-layers-sig"], d.name + "'s drop read is signed");
    assert(RU.anonReads.slice(fromAnon).filter((x) => x.dev === d.name).length === 1, d.name + " did not read the anon list once");
  }
  const writers = new Set(RU.requests.slice(flowFrom).filter((x) => x.method === "PUT").map((x) => x.dev));
  assert(writers.size === 1 && writers.has(W.owner.name), "drop writers: " + [...writers]);
});
async function fullFailedCheck(Rx, Wx, cast) {
  for (const mode of ["500", "truncated", "count", "badrow", "throw"]) {
    RU.dropMode = mode;
    await tickOn(Rx, Wx.m1);
    RU.dropMode = "ok";
    const st = await on(Wx.m1, () => Rx.received.receivedStatus());
    assert(st.lastTickOk === false && st.rings.length === 1 && st.rings[0].state === "unknown", `${mode}: the record was dropped or still shown: ${JSON.stringify(st)}`);
    assert((await reveal(Rx, Wx.m1, cast)) === null, `${mode}: the merge still shows after a FAILED read`);
    await tickOn(Rx, Wx.m1);
    assert((await reveal(Rx, Wx.m1, cast)) !== null, `${mode}: the next FULL read did not restore the merge`);
  }
}
await check("F6 U7 FULL vs FAILED: a 500, a cut-off body, a count mismatch, one bad row and an unreachable drop each HIDE the merge and KEEP the record ('unknown'); the next FULL read restores it with no new publish", async () => {
  const gen = await on(W.owner, async () => (await R.model.loadRingsDoc()).publish.gen);
  await fullFailedCheck(R, W, posts.alice.castHash);
  assert((await on(W.owner, async () => (await R.model.loadRingsDoc()).publish.gen)) === gen, "a publish happened");
});
async function seqCheck(Rx, Wx) {
  // the operator re-serves the OLDER generation beside the newer one, then ALONE: the newer seq stays
  const old = dropRows();
  const seqOld = (await on(Wx.m1, () => Rx.received.receivedStatus())).rings.length;
  void seqOld;
  await new Promise((r) => setTimeout(r, 5));
  await on(Wx.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wx.m1);
  const newest = (globalThis.__layersRingsReceived ? [...globalThis.__layersRingsReceived.records.values()][0].seq : null);
  const ins = V.db.prepare("INSERT OR IGNORE INTO ring_drop (id, enc, ct, hint, expires_hour, del_hash) VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of old) ins.run(r.id, r.enc, r.ct, r.hint, r.expires_hour, r.del_hash);
  await tickOn(Rx, Wx.m1);
  const after = [...globalThis.__layersRingsReceived.records.values()][0].seq;
  assert(newest !== null && after === newest, `a re-served older generation replaced the newer one (${after} vs ${newest})`);
  // remove the newer generation: only the older is served — the record stays (seen), its seq does not go back
  const oldIds = new Set(old.map((r) => r.id));
  for (const r of dropRows()) if (!oldIds.has(r.id)) V.db.prepare("DELETE FROM ring_drop WHERE id = ?").run(r.id);
  await tickOn(Rx, Wx.m1);
  const recs = [...globalThis.__layersRingsReceived.records.values()];
  assert(recs.length === 1 && recs[0].seq === newest, "with only the older generation served the record went back to it");
  for (const r of old) V.db.prepare("DELETE FROM ring_drop WHERE id = ?").run(r.id);
  await on(Wx.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wx.m1);
}
await check("F7 U5 monotonic seq: a re-served OLDER generation never replaces the newer record (beside it, or alone)", () => seqCheck(R, W));
await check("F8 the publisher swaps generations in ONE signed request (new rows + the old tokens), and the drop then holds only the new generation", async () => {
  const before = dropRows().map((r) => r.id);
  const from = RU.requests.length;
  const r = await on(W.owner, () => R.publisher.publishOnce({ force: true }));
  assert(r.ok && r.deleted === before.length, "publish: " + JSON.stringify(r));
  const puts = RU.requests.slice(from).filter((x) => x.method === "PUT");
  assert(puts.length === 1, puts.length + " PUTs for one generation");
  const body = JSON.parse(puts[0].body);
  assert(body.rows.length === 4 && body.deletes.length === before.length, "the swap request: " + body.rows.length + " rows, " + body.deletes.length + " deletes");
  const now = dropRows().map((r) => r.id);
  assert(now.length === 4 && now.every((id) => !before.includes(id)), "the old generation is still on the drop");
});
await check("F9 U9 a refused PUT keeps the OLD rows (nothing deleted, the document not advanced), names the error, and the next publish succeeds", async () => {
  const before = dropRows().map((r) => r.id).sort().join();
  const live = await on(W.owner, async () => (await R.model.loadRingsDoc()).live.map((x) => x.rowId).sort().join());
  RU.putFail = 503;
  const r = await on(W.owner, () => R.publisher.publishOnce({ force: true }));
  RU.putFail = null;
  assert(!r.ok && /refused/.test(r.error), "publish under a refused PUT: " + JSON.stringify(r));
  assert(dropRows().map((x) => x.id).sort().join() === before, "the drop changed under a refused PUT");
  assert((await on(W.owner, async () => (await R.model.loadRingsDoc()).live.map((x) => x.rowId).sort().join())) === live, "the document advanced");
  assert((await on(W.owner, () => R.publisher.publishStatus())).lastError, "no lastError");
  const ok = await on(W.owner, () => R.publisher.publishOnce({ force: true }));
  assert(ok.ok, "the next publish failed: " + JSON.stringify(ok));
  assert(!(await on(W.owner, () => R.publisher.publishStatus())).lastError, "lastError survived a success");
});
async function revokeCheck(Rx, Wx, ringIdx, m2Id) {
  await tickOn(Rx, Wx.m2);
  const captured = await on(Wx.m2, () => Rx.received.receivedNoteKeysForDebug());
  assert(captured.length > 0, "m2 holds no keys to capture");
  const genBefore = await on(Wx.owner, async () => (await Rx.model.loadRingsDoc()).personas[Wx.A.id].gen);
  const rowsBefore = dropRows().length;
  const rv = await on(Wx.owner, () => Rx.outbound.revokeMember(ringIdx, m2Id));
  assert(rv.deleted === true, "the revoked member's rows were not deleted: " + JSON.stringify(rv));
  assert(dropRows().length === rowsBefore - 1, "the revoke deleted " + (rowsBefore - dropRows().length) + " rows, not the member's one");
  const genAfter = await on(Wx.owner, async () => (await Rx.model.loadRingsDoc()).personas[Wx.A.id].gen);
  assert(genAfter === genBefore + 1, `the key did not rotate (gen ${genBefore} → ${genAfter})`);
  const p = await anonPost(Rx, Wx.owner, Wx.A, "alice after the revoke " + hex(3));
  assert(Rx.note.openNote(p.note, p.castHash, captured.map((k) => k.keyHex)) === null, "the revoked member's captured keys open a post made after the revoke");
  const older = Rx.note.openNote(posts.alice.note, posts.alice.castHash, captured.map((k) => k.keyHex));
  assert(older !== null, "positive control: the captured keys do open a post made before the revoke");
  await tickOn(Rx, Wx.m2);
  assert((await on(Wx.m2, () => Rx.received.receivedStatus())).rings.length === 0, "the revoked member's record survived a FULL read without its row (U8)");
  assert((await reveal(Rx, Wx.m2, p.castHash)) === null && (await reveal(Rx, Wx.m2, posts.alice.castHash)) === null, "the revoked member still renders a merge");
  await tickOn(Rx, Wx.m1);
  assert((await reveal(Rx, Wx.m1, p.castHash)) === null, "m1 opened the new post BEFORE the next publish carried the new key");
  await on(Wx.owner, () => Rx.publisher.publishOnce());
  await tickOn(Rx, Wx.m1);
  assert((await reveal(Rx, Wx.m1, p.castHash))?.persona.handle === Wx.A.handle, "the remaining member does not open the post made after the revoke, after the next publish");
  return p;
}
await check("F10 REVOKE rotates the key and deletes the row at once: the revoked member's captured keys open the post made before and NOT the one after; its record drops on the next FULL read (U8); the remaining member opens the new post after the next publish", async () => {
  posts.afterRevoke = await revokeCheck(R, W, ringId, memberIds.m2);
});
async function sinceCheck(Rx, Wx, ring) {
  const a = await on(Wx.n1, async () => (await Rx.inbox.listAddresses())[0]);
  await on(Wx.owner, () => Rx.outbound.addMember(ring, a.address, "Nia"));
  const p = await anonPost(Rx, Wx.owner, Wx.A, "alice after n1 joined " + hex(3));
  await on(Wx.owner, () => Rx.publisher.publishOnce());
  await tickOn(Rx, Wx.n1);
  assert((await reveal(Rx, Wx.n1, p.castHash))?.persona.handle === Wx.A.handle, "positive control: the new member does not see a post made after it joined");
  assert((await reveal(Rx, Wx.n1, posts.alice.castHash)) === null, "a member added later opens a post made BEFORE it joined");
  assert((await reveal(Rx, Wx.n1, posts.afterRevoke.castHash)) === null, "a member added later opens the post made before it joined (after the revoke)");
  return p;
}
await check("F11 a member added LATER never opens posts made before it joined (its keys start at the rotation its joining caused); it does open the ones after", async () => {
  posts.afterJoin = await sinceCheck(R, W, ringId);
});
await check("F12 LOWERING a ring's depth ('posts' → 'name') rotates the key: a post made after it opens for no member, and the members' cards stop showing the earlier ones too (their envelopes carry no key any more); raising it again starts a NEW generation", async () => {
  await on(W.owner, () => R.outbound.setDepth(ringId, W.A.id, "name"));
  const p = await anonPost(R, W.owner, W.A, "alice after the ring was lowered");
  assert(p.note.length === 512, "length");
  await on(W.owner, () => R.publisher.publishOnce());
  for (const d of [W.m1, W.n1]) await tickOn(R, d);
  for (const d of [W.m1, W.n1]) assert((await reveal(R, d, p.castHash)) === null, d.name + " opens a post made after the ring was lowered");
  assert((await reveal(R, W.m1, posts.afterJoin.castHash)) === null, "a 'name'-depth subject still reveals posts (its note keys should be gone from the envelope)");
  await on(W.owner, () => R.outbound.setDepth(ringId, W.A.id, "posts"));
  posts.afterRaise = await anonPost(R, W.owner, W.A, "alice after the ring was raised again");
  await on(W.owner, () => R.publisher.publishOnce());
  for (const d of [W.m1, W.n1]) await tickOn(R, d);
  for (const d of [W.m1, W.n1]) assert((await reveal(R, d, posts.afterRaise.castHash))?.persona.handle === W.A.handle, d.name + " does not open a post made after the ring was raised again");
  assert((await reveal(R, W.m1, p.castHash)) === null, "the post made while the ring was lowered opens after the raise");
});
await check("F13 fid merges and admissible subjects: @carol (owns fid 424242) at 'name' merges cards by that fid as root-left (linked = the root's fname, an inline face, never a URL); the persona on Totem's own test account (FC_RESERVED) never carries its fid; a private persona and the public self are refused", async () => {
  RU.reservedFids = [9152];
  await on(W.owner, () => R.outbound.setDepth(ringId, W.C.id, "name"));
  await on(W.owner, () => R.outbound.setDepth(ringId, W.T.id, "name"));
  for (const bad of [W.P, W.S]) {
    let refused = false;
    try {
      await on(W.owner, () => R.outbound.setDepth(ringId, bad.id, "name"));
    } catch (e) {
      refused = /public personas/.test(e.message);
    }
    assert(refused, bad.handle + " was admitted");
  }
  await on(W.owner, () => R.publisher.publishOnce());
  await tickOn(R, W.m1);
  const m = await on(W.m1, () => R.merge.mergedAuthorForFid(424242));
  assert(m && m.merged && m.linked.tier === "ring" && m.linked.username === "rootyfname" && m.linked.pfpUrl === "" && m.linked.sharedBy === "Rooty Root", "merge: " + JSON.stringify(m));
  assert((await on(W.m1, () => R.merge.mergedAuthorForFid(9152))) === null, "Totem's own test-account fid merged");
  assert((await on(W.n2, () => R.merge.mergedAuthorForFid(424242))) === null, "a non-member merged");
  const sh = await on(W.m1, () => R.merge.sharedForFid(424242));
  assert(sh && sh.persona.handle === W.C.handle && sh.label === "Rooty Root" && sh.others.some((o) => o.handle === W.A.handle), "profile view: " + JSON.stringify(sh));
  RU.reservedFids = [];
});
async function compartmentCheck(Rx, Wx, cast) {
  assert((await reveal(Rx, Wx.m1, cast)) !== null, "positive control");
  Wx.m1.compartment = true;
  await tickOn(Rx, Wx.m1);
  assert((await reveal(Rx, Wx.m1, cast)) === null, "compartment mode shows a ring merge");
  assert((await on(Wx.m1, () => Rx.merge.mergedAuthorForFid(424242))) === null, "compartment mode shows a fid merge");
  Wx.m1.compartment = false;
  await tickOn(Rx, Wx.m1);
  assert((await reveal(Rx, Wx.m1, cast)) !== null, "leaving compartment mode did not restore the merge");
  await on(Wx.m1, () => {
    delete globalThis.__layersPersonaChrome;
  });
  assert((await reveal(Rx, Wx.m1, cast)) === null, "an UNREAD chrome document shows a merge (must read as compartment on)");
  await tickOn(Rx, Wx.m1);
}
await check("F14 compartment mode hides every merge; an unread chrome document hides them too (never a guess)", () => compartmentCheck(R, W, posts.afterRaise.castHash));
await check("F15 an unreadable root headshot sends NOTHING (no PUT, the old rows stay) and says so", async () => {
  const before = dropRows().map((r) => r.id).sort().join();
  const from = RU.requests.length;
  W.owner.root = "throw";
  const r = await on(W.owner, () => R.publisher.publishOnce({ force: true }));
  W.owner.root = ROOT_FACE;
  assert(!r.ok && /public face/.test(r.error), "publish: " + JSON.stringify(r));
  assert(!RU.requests.slice(from).some((x) => x.method === "PUT"), "a PUT was sent");
  assert(dropRows().map((x) => x.id).sort().join() === before, "the drop changed");
});
await check("F16 U10 padding: 1 member → 4 rows, 5 members → 8 rows (dummies, byte-shaped)", async () => {
  // an isolated drop for this count; the main world's rows are put back afterwards
  const saved = V.db.prepare("SELECT * FROM ring_drop").all().map((r) => ({ ...r }));
  V.db.exec("DELETE FROM ring_drop");
  try {
    return await paddingCheck();
  } finally {
    V.db.exec("DELETE FROM ring_drop");
    const ins = V.db.prepare("INSERT INTO ring_drop (id, enc, ct, hint, expires_hour, del_hash) VALUES (?, ?, ?, ?, ?, ?)");
    for (const r of saved) ins.run(r.id, r.enc, r.ct, r.hint, r.expires_hour, r.del_hash);
  }
});
async function paddingCheck() {
  const W2 = world();
  const r2 = (await on(W2.owner, () => R.outbound.createRing("Solo"))).id;
  await on(W2.owner, () => R.outbound.setDepth(r2, W2.A.id, "posts"));
  const a = await address(R, W2.m1);
  await on(W2.owner, () => R.outbound.addMember(r2, a.address));
  const one = await on(W2.owner, () => R.publisher.publishOnce({ force: true }));
  assert(one.ok && one.rows === 4 && one.real === 1, "1 member: " + JSON.stringify(one));
  for (const d of [W2.m2, W2.n1, W2.n2, newDevice("x" + W2.w)]) {
    const ad = await address(R, d);
    await on(W2.owner, () => R.outbound.addMember(r2, ad.address));
  }
  const five = await on(W2.owner, () => R.publisher.publishOnce({ force: true }));
  assert(five.ok && five.rows === 8 && five.real === 5, "5 members: " + JSON.stringify(five));
  assert(dropRows().length === 8 && dropRows().every((x) => x.ct.length === 8224 && x.enc.length === 64 && x.hint.length === 4), "the drop after the swap: " + dropRows().length);
  return "4 and 8";
}
await check("F17 a LINKED device cannot hold a ring address (plain words: open this on the device that holds your identity)", async () => {
  const L = newDevice("linked", { linked: true });
  let msg = null;
  try {
    await address(R, L);
  } catch (e) {
    msg = e.message;
  }
  assert(msg && /device that holds your identity/.test(msg), "a linked device made an address: " + msg);
});
await check("F18 the FIRST tick of every device writes the 'rings' document once (the same padded size class, rings or none); later ticks write nothing; a member's ticks never write its vault (what it received is memory only)", async () => {
  const fresh1 = newDevice("fresh1");
  const fresh2 = newDevice("fresh2");
  const from = RU.vaultLog.length;
  await tickOn(R, fresh1);
  await tickOn(R, fresh2);
  await tickOn(R, fresh1);
  const writes = RU.vaultLog.slice(from).filter((x) => x.kind === "write");
  assert(writes.length === 2 && writes.every((x) => x.ns === "rings"), "first-tick writes: " + JSON.stringify(writes));
  const size = (d) => JSON.stringify(d.vault.get("rings")).length;
  assert(size(fresh1) === size(fresh2), "two empty documents differ in size");
  const W3 = world();
  const r3 = (await on(W3.owner, () => R.outbound.createRing("Big"))).id;
  for (const p of [W3.A, W3.B, W3.C]) await on(W3.owner, () => R.outbound.setDepth(r3, p.id, "posts"));
  const a = await address(R, W3.m1);
  await on(W3.owner, () => R.outbound.addMember(r3, a.address));
  await tickOn(R, W3.m1);
  const fromM = RU.vaultLog.length;
  await on(W3.owner, () => R.publisher.publishOnce({ force: true }));
  for (let i = 0; i < 3; i++) await tickOn(R, W3.m1);
  assert(!RU.vaultLog.slice(fromM).some((x) => x.kind === "write" && x.dev === W3.m1.name), "a member's tick wrote its vault after a publish");
  assert((await on(W3.m1, () => R.received.receivedStatus())).rings.length === 1, "positive control: the member did receive");
});
await check("F19 the composer path needs no request: with the document only in the whole-state hydrate's copy, noteForPost answers with ZERO vault reads", async () => {
  const W4 = world();
  const r4 = (await on(W4.owner, () => R.outbound.createRing("Hydrate"))).id;
  await on(W4.owner, () => R.outbound.setDepth(r4, W4.A.id, "posts"));
  await on(W4.owner, () => {
    R.model.resetRingsDocCache();
    globalThis.__layersHydratedNs = { rings: JSON.parse(JSON.stringify(W4.owner.vault.get("rings"))) };
    // the real persist.ts records WHEN the whole-state read happened (LP-2: a copy is only as fresh as its read)
    globalThis.__layersHydratedNsAt = { rings: Date.now() };
  });
  const from = RU.vaultLog.length;
  const reqFrom = RU.requests.length;
  const ch = hex(32);
  const n = await on(W4.owner, () => R.note.noteForPost("fixture", W4.A.id, ch));
  const k = await on(W4.owner, () => R.model.noteKeyForPost(W4.A.id));
  assert(R.note.openNoteWith(n, ch, k.keyHex) === k.ref, "the note from the hydrate's copy is not the real one");
  assert(RU.vaultLog.length === from && RU.requests.length === reqFrom, "the composer path made a request");
});

await check("F20 U6 expiry: a record whose lease has run out is DROPPED at the next FULL read (and never rendered meanwhile)", async () => {
  const before = await on(W.m1, () => R.received.receivedStatus());
  assert(before.rings.length === 1, "positive control: m1 holds a record");
  const later = before.rings[0].expiresAt + 1000;
  assert((await on(W.m1, () => R.merge.ringRevealForAnon(posts.afterRaise.castHash, "fixture"))) !== null, "positive control: the merge renders now");
  const got = await on(W.m1, () => R.fetchm.fetchRingDrop());
  const keys = await on(W.m1, () => R.inbox.activeInboxKeys());
  await on(W.m1, () => R.received.applyFetch(got, keys, later));
  assert((await on(W.m1, () => R.received.receivedStatus(later))).rings.length === 0, "an expired record survived a FULL read");
  await tickOn(R, W.m1);
  assert((await on(W.m1, () => R.received.receivedStatus())).rings.length === 1, "the next ordinary read did not bring the (still valid) record back");
});

// ================================================================================================ W — wave 2 review fixes
console.log("\nW — wave 2 review fixes (LP-2, LP-3, KEEP3, ONE-RING, UX-R1, UX-R4, LP-5)");
/** a second device of the SAME root (a linked device: no seed), sharing the root's vault and anchor */
function linkedTwin(A, name) {
  const B = newDevice(name, { linked: true, personas: A.personas, fids: A.fids, root: A.root });
  B.vault = A.vault;
  B.vaultKey = A.vaultKey;
  B.anchor = A.anchor;
  return B;
}
const storedDoc = (Rx, dev) => on(dev, async () => (await Rx.model.refreshRingsDoc()).doc);

/** LP-2: A revokes on its device; the twin's next tick re-reads, so its notes and its publish follow the revoke */
async function twoDevicesCheck(Rx) {
  const Wt = world();
  const A = Wt.owner;
  const B = linkedTwin(A, "twin" + Wt.w);
  const rid = (await on(A, () => Rx.outbound.createRing("Shared"))).id;
  await on(A, () => Rx.outbound.setDepth(rid, Wt.A.id, "posts"));
  const a1 = await on(Wt.m1, () => Rx.inbox.createAddress(null));
  const a2 = await on(Wt.m2, () => Rx.inbox.createAddress(null));
  await on(A, () => Rx.outbound.addMember(rid, a1.address, "stays"));
  const m2Id = (await on(A, () => Rx.outbound.addMember(rid, a2.address, "goes"))).memberId;
  await on(A, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [B, Wt.m1, Wt.m2]) await tickOn(Rx, d);
  const captured = (await on(Wt.m2, () => Rx.received.receivedNoteKeysForDebug())).map((k) => k.keyHex);
  assert(captured.length > 0, "m2 holds no keys to capture");
  const pre = await anonPost(Rx, B, Wt.A, "twin before the revoke " + hex(3));
  assert(Rx.note.openNote(pre.note, pre.castHash, captured) !== null, "positive control: the twin's note made BEFORE the revoke opens under the member's keys");
  await on(A, () => Rx.outbound.revokeMember(rid, m2Id));
  await tickOn(Rx, B); // the uniform re-read
  const post = await anonPost(Rx, B, Wt.A, "twin after the revoke " + hex(3));
  assert(Rx.note.openNote(post.note, post.castHash, captured) === null, "the twin's note made AFTER A's revoke opens under the revoked member's keys (the twin posted from a stale document)");
  const pub = await on(B, () => Rx.publisher.publishOnce({ force: true }));
  assert(pub.ok, "the twin's publish: " + JSON.stringify(pub));
  const doc = await storedDoc(Rx, A);
  // PERSONA LAUNCH GO-LIVE (UXH-9): a revoke now HIDES the record (hide, never delete) — the twin's stale copy would
  // carry it back with hiddenAt null, so "still hidden and exactly one person in use" is the same check as before
  const gone = doc.rings[rid]?.members[m2Id];
  assert(doc.rings[rid] && gone && gone.hiddenAt > 0 && Object.values(doc.rings[rid].members).filter((m) => m.hiddenAt === null).length === 1, "the twin sealed its old copy over A's revoke");
  await tickOn(Rx, Wt.m2);
  assert((await on(Wt.m2, () => Rx.received.receivedStatus())).rings.length === 0, "the revoked member still opens an envelope after the twin's publish");
  await tickOn(Rx, Wt.m1);
  assert((await reveal(Rx, Wt.m1, post.castHash))?.persona.handle === Wt.A.handle, "positive control: the remaining member opens the twin's post after the twin's publish");
  return { Wt, B };
}
let twin = null;
await check("W1 LP-2 TWO DEVICES, ONE ROOT: A revokes a member; the linked twin's next tick re-reads the document, so the twin's next anon post is NOT readable with the revoked member's keys, the twin's publish seals to nobody revoked and leaves A's revoke in the vault, and the remaining member opens the twin's post", async () => {
  twin = await twoDevicesCheck(R);
});

/** LP-2: a change in flight on the twin while A seals is REFUSED at the twin's seal (nothing written, the newer copy adopted) */
async function raceCheck(Rx) {
  const Wr = world();
  const A = Wr.owner;
  const B = linkedTwin(A, "race" + Wr.w);
  const rid = (await on(A, () => Rx.outbound.createRing("Race"))).id;
  const a2 = await on(Wr.m2, () => Rx.inbox.createAddress(null));
  const m2Id = (await on(A, () => Rx.outbound.addMember(rid, a2.address))).memberId;
  await tickOn(Rx, B);
  let entered;
  const enteredP = new Promise((r) => (entered = r));
  let release;
  const gate = new Promise((r) => (release = r));
  use(B);
  const pB = Rx.model.mutateRingsDoc(async (d) => {
    entered();
    await gate;
    d.rings[rid].label = "Renamed on the twin";
    return "sealed";
  });
  pB.catch(() => undefined);
  await enteredP;
  await on(A, () => Rx.outbound.revokeMember(rid, m2Id)); // A seals while the twin's change is in flight
  use(B);
  release();
  let err = null;
  try {
    await pB;
  } catch (e) {
    err = e;
  }
  assert(err && err.name === "RingsChanged" && /another of your devices/.test(err.message), "the twin's stale change was not refused: " + (err ? err.message : "it sealed"));
  const doc = await storedDoc(Rx, A);
  assert(doc.rings[rid].members[m2Id]?.hiddenAt > 0 && doc.rings[rid].label === "Race", "the twin's refused change overwrote A's revoke");
  const again = await on(B, () => Rx.model.mutateRingsDoc((d) => {
    d.rings[rid].label = "Renamed on the twin";
    return "sealed";
  }));
  const doc2 = await storedDoc(Rx, A);
  assert(again === "sealed" && doc2.rings[rid].label === "Renamed on the twin" && doc2.rings[rid].members[m2Id]?.hiddenAt > 0, "positive control: the same change, tried again on the newer copy, lands on top of the revoke");
}
await check("W2 LP-2 THE SEAL RE-CHECKS: a change in flight on the twin while A seals a revoke is REFUSED in plain words (nothing written, A's revoke stands), and the same change tried again lands on top of it", () => raceCheck(R));

/** LP-2: the composer refuses a REAL note from a document not re-checked within RINGS_NOTE_MAX_AGE_MS */
async function staleCheck(Rx) {
  const Ws = world();
  const rid = (await on(Ws.owner, () => Rx.outbound.createRing("Stale"))).id;
  await on(Ws.owner, () => Rx.outbound.setDepth(rid, Ws.A.id, "posts"));
  const ok = await on(Ws.owner, () => Rx.note.noteForPost("fixture", Ws.A.id, hex(32)));
  assert(ok.length === 512, "positive control: a fresh document makes the note");
  await on(Ws.owner, () => {
    globalThis.__layersRings.freshAt = Date.now() - Rx.model.RINGS_NOTE_MAX_AGE_MS - 60_000;
  });
  let threw = null;
  try {
    await on(Ws.owner, () => Rx.note.noteForPost("fixture", Ws.A.id, hex(32)));
  } catch (e) {
    threw = e;
  }
  assert(threw && threw.name === "RingsStale" && /try again in a minute/.test(threw.message), "a real note was sealed from a document not re-checked for " + Math.round(Rx.model.RINGS_NOTE_MAX_AGE_MS / 60_000) + "+ minutes: " + (threw ? threw.message : "no refusal"));
  const rnd = await on(Ws.owner, () => Rx.note.noteForPost("fixture", Ws.B.id, hex(32)));
  assert(rnd.length === 512, "a persona no ring sees at 'posts' was held up (its note is random either way)");
  await tickOn(Rx, Ws.owner);
  assert((await on(Ws.owner, () => Rx.note.noteForPost("fixture", Ws.A.id, hex(32)))).length === 512, "the next tick did not make the document fresh again");
}
await check("W3 LP-2 a REAL ring note is refused from a document not re-checked within a few ticks (a device that slept through a revoke elsewhere); a persona at no 'posts' ring is not held up; the next tick clears it", () => staleCheck(R));

/** LP-3: making an address writes and sends NOTHING; the claim rides a deferred upkeep at a random moment */
async function claimCheck(Rx) {
  const Wc = world();
  const X = newDevice("claimer" + Wc.w);
  await tickOn(Rx, X);
  const spares0 = await on(X, async () => Object.values((await Rx.model.loadRingsDoc()).inbox).filter((e) => e.spare && !e.forgottenAt).length);
  assert(spares0 === Rx.model.SPARE_ADDRESSES, "the first-tick write made " + spares0 + " spares");
  const reqFrom = RU.requests.length;
  const vFrom = RU.vaultLog.length;
  const a = await on(X, () => Rx.inbox.createAddress("for Ana"));
  assert(RU.vaultLog.length === vFrom && RU.requests.length === reqFrom, "making an address read, wrote or sent something at the click (" + (RU.vaultLog.length - vFrom) + " vault ops, " + (RU.requests.length - reqFrom) + " requests)");
  assert((await on(X, () => Rx.inbox.listAddresses())).some((v) => v.addrId === a.addrId && v.label === "for Ana"), "the handed-out address is not listed with its name");
  const rid = (await on(Wc.owner, () => Rx.outbound.createRing("Claim"))).id;
  await on(Wc.owner, () => Rx.outbound.setDepth(rid, Wc.A.id, "name"));
  await on(Wc.owner, () => Rx.outbound.addMember(rid, a.address));
  await on(Wc.owner, () => Rx.publisher.publishOnce({ force: true }));
  const vTick = RU.vaultLog.length;
  await tickOn(Rx, X);
  assert((await on(X, () => Rx.received.receivedStatus())).rings.length === 1, "positive control: the handed-out spare does not receive before anything was written");
  assert(!RU.vaultLog.slice(vTick).some((x) => x.kind === "write" && x.dev === X.name), "the claimer's next tick wrote at once (the upkeep is deferred)");
  const now = Date.now();
  assert((await on(X, () => Rx.inbox.inboxUpkeep(now))) === "scheduled", "the upkeep was not scheduled");
  const due = await on(X, () => Rx.model.upkeepDueAt());
  assert(due - now >= Rx.inbox.UPKEEP_MIN_MS - 5000 && due - now <= Rx.inbox.UPKEEP_MAX_MS, "the upkeep's moment is outside its window: " + (due - now) + " ms");
  const vUp = RU.vaultLog.length;
  assert((await on(X, () => Rx.inbox.inboxUpkeep(due + 1))) === "written", "the upkeep did not write at its moment");
  assert(RU.vaultLog.slice(vUp).filter((x) => x.kind === "write" && x.dev === X.name).length === 1, "the upkeep is not ONE write");
  const stored = await storedDoc(Rx, X);
  const e = stored.inbox[a.addrId];
  assert(e && e.spare === false && e.label === "for Ana", "the claim was not kept by the upkeep: " + JSON.stringify(e));
  assert(Object.values(stored.inbox).filter((x) => x.spare && !x.forgottenAt).length === Rx.model.SPARE_ADDRESSES, "the upkeep did not make a new spare");
  // every spare handed out → refused in plain words, nothing written
  const vNo = RU.vaultLog.length;
  for (let i = 0; i < Rx.model.SPARE_ADDRESSES; i++) await on(X, () => Rx.inbox.createAddress(null));
  let refused = null;
  try {
    await on(X, () => Rx.inbox.createAddress(null));
  } catch (er) {
    refused = er;
  }
  assert(refused && /made in the background/.test(refused.message), "a fourth address with no spare left: " + (refused ? refused.message : "made"));
  assert(!RU.vaultLog.slice(vNo).some((x) => x.kind === "write"), "running out of spares wrote something");
  // a restart before the upkeep: the handed-out address still receives (spares are trial-opened like any address)
  const Y = newDevice("restarter" + Wc.w);
  await tickOn(Rx, Y);
  const ay = await on(Y, () => Rx.inbox.createAddress("lost on restart"));
  await on(Wc.owner, () => Rx.outbound.addMember(rid, ay.address));
  await on(Wc.owner, () => Rx.publisher.publishOnce({ force: true }));
  await on(Y, () => Rx.tick.resetRingsCaches());
  await tickOn(Rx, Y);
  assert((await on(Y, () => Rx.received.receivedStatus())).rings.length === 1, "an address handed out before a restart stopped receiving");
}
await check("W4 LP-3 making a private address sends and writes NOTHING (a spare made in the first-tick write is handed out); it receives at once; its claim is kept by ONE write at a random moment 15 min–3 h later, which also makes a new spare; with no spare left it is refused in plain words; a restart before the upkeep loses no reception", () => claimCheck(R));

/** KEEP3: routine adds never cost an existing member a post it already saw; a newcomer never opens one made before it joined */
async function historyCheck(Rx, adds = 6) {
  const Wh = world();
  const rid = (await on(Wh.owner, () => Rx.outbound.createRing("History"))).id;
  await on(Wh.owner, () => Rx.outbound.setDepth(rid, Wh.A.id, "posts"));
  const a1 = await on(Wh.m1, () => Rx.inbox.createAddress(null));
  await on(Wh.owner, () => Rx.outbound.addMember(rid, a1.address));
  const p0 = await anonPost(Rx, Wh.owner, Wh.A, "history first " + hex(3));
  await on(Wh.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wh.m1);
  assert((await reveal(Rx, Wh.m1, p0.castHash))?.persona.handle === Wh.A.handle, "positive control: the first member opens the first post");
  let last = null;
  for (let i = 0; i < adds; i++) {
    const d = newDevice("hist" + i + Wh.w);
    const a = await on(d, () => Rx.inbox.createAddress(null));
    await on(Wh.owner, () => Rx.outbound.addMember(rid, a.address));
    await on(Wh.owner, () => Rx.publisher.publishOnce({ force: true }));
    last = d;
  }
  await tickOn(Rx, Wh.m1);
  assert((await reveal(Rx, Wh.m1, p0.castHash))?.persona.handle === Wh.A.handle, `after ${adds} routine adds the first member no longer opens the post it already saw`);
  const keys = await on(Wh.m1, () => [...globalThis.__layersRingsReceived.records.values()].flatMap((r) => r.subjects.flatMap((s) => s.noteKeys ?? [])));
  assert(keys.length > 0 && keys.every((k) => Object.keys(k).sort().join() === "keyHex,n" && k.n % 4 === 0), "LP-5: a sealed note key is not exactly {keyHex, n} with n a multiple of 4: " + JSON.stringify(keys).slice(0, 200));
  await tickOn(Rx, last);
  assert((await reveal(Rx, last, p0.castHash)) === null, "the newest member opens a post made before it joined");
  const p1 = await anonPost(Rx, Wh.owner, Wh.A, "history after the adds " + hex(3));
  for (const d of [Wh.m1, last]) await tickOn(Rx, d);
  for (const d of [Wh.m1, last]) assert((await reveal(Rx, d, p1.castHash))?.persona.handle === Wh.A.handle, d.name + " does not open the post made after the adds");
}
await check("W5 KEEP3 six routine adds later the first member STILL opens the post it saw before them (chain steps, not fresh keys); the newest member never opens it; both open a post made after; the sealed keys carry no generation number, step counts in fours (LP-5)", () => historyCheck(R));

/** ONE-RING: refused up front in plain words; a ring that overflows later is skipped alone (its rows kept), the rest publish */
async function oneRingCheck(Rx) {
  worldSeq++;
  const tag = "x" + worldSeq;
  const many = newDevice("many" + tag, {
    root: ROOT_FACE,
    personas: Array.from({ length: 16 }, (_, i) => ({ id: "p_many_" + i + "_" + tag, kind: "public", handle: ("manyhandle" + i + "_" + tag).padEnd(64, "x"), name: ("Many Persona " + i).padEnd(48, "y"), avatarUrl: null })),
  });
  const big = (await on(many, () => Rx.outbound.createRing("Big"))).id;
  const small = (await on(many, () => Rx.outbound.createRing("Small"))).id;
  const mb = newDevice("mb" + tag);
  const ms = newDevice("ms" + tag);
  const ab = await on(mb, () => Rx.inbox.createAddress(null));
  const as = await on(ms, () => Rx.inbox.createAddress(null));
  await on(many, () => Rx.outbound.addMember(big, ab.address));
  await on(many, () => Rx.outbound.addMember(small, as.address));
  let refusedAt = null;
  for (let i = 0; i < 16; i++) {
    try {
      await on(many, () => Rx.outbound.setDepth(big, many.personas[i].id, "posts"));
    } catch (e) {
      refusedAt = { i, msg: e.message };
      break;
    }
  }
  assert(refusedAt && refusedAt.i >= 2 && /can't show that much in one sealed note/.test(refusedAt.msg), "raising personas to 'posts' was never refused up front: " + JSON.stringify(refusedAt));
  const depths = await on(many, async () => Object.keys((await Rx.model.loadRingsDoc()).rings[big].depths).length);
  assert(depths === refusedAt.i, "the refused change was saved anyway (" + depths + " depths)");
  await on(many, () => Rx.outbound.setDepth(small, many.personas[0].id, "name"));
  const first = await on(many, () => Rx.publisher.publishOnce({ force: true }));
  assert(first.ok && !first.skippedRings, "positive control, the first publish: " + JSON.stringify(first));
  const bigRowIds = await on(many, async () => (await Rx.model.loadRingsDoc()).live.filter((x) => x.owner && x.owner.startsWith(big + "|")).map((x) => x.rowId));
  assert(bigRowIds.length === 1, "the big ring's rows after the first publish: " + bigRowIds.length);
  // a ring pushed past the envelope AFTER the check (forced straight into the document, as a persona rename would)
  await on(many, () => Rx.model.mutateRingsDoc((d) => {
    for (const p of many.personas) {
      if (d.rings[big].depths[p.id] === "posts") continue;
      d.rings[big].depths[p.id] = "posts";
      const g = Rx.model.advance(d, p.id);
      for (const m of Object.values(d.rings[big].members)) m.since[p.id] = g;
    }
  }));
  const second = await on(many, () => Rx.publisher.publishOnce({ force: true }));
  assert(second.ok && (second.skippedRings ?? []).join() === "Big" && /"Big" can't fit/.test(second.error ?? ""), "the overflowing ring blocked the publish or was not named: " + JSON.stringify(second));
  const ids = new Set(dropRows().map((r) => r.id));
  assert(bigRowIds.every((id) => ids.has(id)), "the skipped ring's previous rows were deleted");
  for (const d of [mb, ms]) await tickOn(Rx, d);
  assert((await on(mb, () => Rx.received.receivedStatus())).rings.length === 1, "the skipped ring's member lost its note at once");
  assert((await on(ms, () => Rx.received.receivedStatus())).rings.length === 1, "the other ring's member did not receive");
  const pv = await on(many, () => Rx.publisher.publishView());
  assert(/"Big"/.test(pv.lastError ?? ""), "the pane's line does not name the ring: " + pv.lastError);
}
await check("W6 ONE-RING raising personas to 'posts' is refused UP FRONT in plain words before a ring's note could overflow (nothing saved); a ring pushed past it later is SKIPPED alone — its last rows stay on the drop, its member keeps its note, every other ring publishes, the error names it", () => oneRingCheck(R));

/** UX-R1: with no "share as" name and no main account, members see "a friend" — never the ring's own name */
async function neutralLabelCheck(Rx) {
  const Wn = world();
  Wn.owner.root = null;
  const rid = (await on(Wn.owner, () => Rx.outbound.createRing("Secret Ring Name"))).id;
  await on(Wn.owner, () => Rx.outbound.setDepth(rid, Wn.A.id, "name"));
  const a = await on(Wn.m1, () => Rx.inbox.createAddress(null));
  await on(Wn.owner, () => Rx.outbound.addMember(rid, a.address));
  await on(Wn.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wn.m1);
  const st1 = await on(Wn.m1, () => Rx.received.receivedStatus());
  assert(st1.rings.length === 1 && st1.rings[0].label === "a friend" && st1.rings[0].root === null, "a member saw: " + JSON.stringify(st1.rings));
  await on(Wn.owner, () => Rx.outbound.renameRing(rid, "Secret Ring Name", "Jo"));
  await on(Wn.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wn.m1);
  assert((await on(Wn.m1, () => Rx.received.receivedStatus())).rings[0].label === "Jo", "positive control: the 'share as' name is what members see");
}
await check("W7 UX-R1 with no 'share as' name and no main account a member sees 'a friend', never the ring's own name (the pane's 'only you see it' is true); a 'share as' name is shown when set", () => neutralLabelCheck(R));

/** UX-R4: forgetting HIDES an address (kept, not trial-opened, not listed); "Use it again" brings it back */
async function forgetCheck(Rx) {
  const Wf = world();
  const rid = (await on(Wf.owner, () => Rx.outbound.createRing("Forget"))).id;
  await on(Wf.owner, () => Rx.outbound.setDepth(rid, Wf.A.id, "name"));
  const a = await on(Wf.m1, () => Rx.inbox.createAddress("kept"));
  await on(Wf.owner, () => Rx.outbound.addMember(rid, a.address));
  await on(Wf.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wf.m1);
  assert((await on(Wf.m1, () => Rx.received.receivedStatus())).rings.length === 1, "positive control: received before forgetting");
  assert((await on(Wf.m1, () => Rx.inbox.forgetAddress(a.addrId))) === true, "forgetAddress did not report a change");
  const doc = await storedDoc(Rx, Wf.m1);
  assert(doc.inbox[a.addrId] && doc.inbox[a.addrId].forgottenAt > 0 && doc.inbox[a.addrId].label === "kept", "the forgotten address was deleted, not hidden: " + JSON.stringify(doc.inbox[a.addrId]));
  assert(!(await on(Wf.m1, () => Rx.inbox.listAddresses())).some((v) => v.addrId === a.addrId), "a forgotten address is still listed");
  assert((await on(Wf.m1, () => Rx.inbox.listForgottenAddresses())).some((v) => v.addrId === a.addrId), "the forgotten address is not offered for 'Use it again'");
  assert(!(await on(Wf.m1, () => Rx.inbox.activeInboxKeys())).some((k) => k.addrId === a.addrId), "a forgotten address is still trial-opened");
  await tickOn(Rx, Wf.m1);
  assert((await on(Wf.m1, () => Rx.received.receivedStatus())).rings.length === 0, "a forgotten address still receives");
  assert((await on(Wf.m1, () => Rx.inbox.restoreAddress(a.addrId))) === true, "'Use it again' did nothing");
  await tickOn(Rx, Wf.m1);
  assert((await on(Wf.m1, () => Rx.received.receivedStatus())).rings.length === 1, "'Use it again' did not bring the address back");
}
await check("W8 UX-R4 'Forget it' HIDES the address (kept with forgottenAt, not listed, not trial-opened, its rings stop reaching you) and 'Use it again' brings it back", () => forgetCheck(R));
/** W2-RINGS-DROP-FILL-DOS (the publisher's side): a half-landed publish withdraws what landed — nothing piles up */
async function partialCheck(Rx) {
  worldSeq++;
  const tag = "p" + worldSeq;
  const P = newDevice("partial" + tag, { root: ROOT_FACE, personas: [{ id: "p_part_" + tag, kind: "public", handle: "partpersona" + tag, name: "Part", avatarUrl: null }] });
  const rid = (await on(P, () => Rx.outbound.createRing("Wide"))).id;
  await on(P, () => Rx.outbound.setDepth(rid, P.personas[0].id, "name"));
  for (let i = 0; i < 29; i++) await on(P, () => Rx.outbound.makeLink(rid));
  const first = await on(P, () => Rx.publisher.publishOnce({ force: true }));
  assert(first.ok && first.rows === 32, "positive control: 29 members → 32 rows in two writes: " + JSON.stringify(first));
  const live = await on(P, async () => (await Rx.model.loadRingsDoc()).live.map((x) => x.rowId).sort());
  const before = new Set(dropRows().map((r) => r.id));
  assert(live.length === 32 && live.every((id) => before.has(id)), "the first publish's rows are not on the drop");
  RU.putSeen = 0;
  RU.putFailNth = 2;
  let second;
  try {
    second = await on(P, () => Rx.publisher.publishOnce({ force: true }));
  } finally {
    RU.putFailNth = 0;
  }
  assert(second && !second.ok && /withdrawn/.test(second.error ?? ""), "the half-refused publish: " + JSON.stringify(second));
  const after = new Set(dropRows().map((r) => r.id));
  assert(live.every((id) => after.has(id)), "the previous generation was deleted by a half-refused publish");
  assert(after.size === before.size, "the half that landed was left on the drop (" + (after.size - before.size) + " extra rows)");
  const docLive = await on(P, async () => (await Rx.model.refreshRingsDoc()).doc.live.map((x) => x.rowId).sort());
  assert(JSON.stringify(docLive) === JSON.stringify(live), "the document changed after a withdrawn publish");
  const third = await on(P, () => Rx.publisher.publishOnce({ force: true }));
  assert(third.ok && third.deleted === 32, "the next publish: " + JSON.stringify(third));
}
await check("W9 a publish whose later batch is refused WITHDRAWS the batch that landed (the previous generation stays, nothing piles up against the device's occupancy, the document is not written); the next publish swaps cleanly", () => partialCheck(R));


// ================================================================================================ H — hide, never delete
// PERSONA LAUNCH GO-LIVE (UXH-9): Remove and Delete ring HIDE the owner's own records (hiddenAt) instead of erasing them;
// every path that reaches a member, the composer or a count skips a hidden record; Restore brings one back as a JOIN
// (a new generation: what was posted while it was removed stays closed). Each guard has its mutation below.
console.log("\nH — hide, never delete (PERSONA LAUNCH GO-LIVE, UXH-9)");
const inUse = (ms) => Object.values(ms).filter((m) => m.hiddenAt === null);
const statusOf = (Rx, dev) => on(dev, () => Rx.received.receivedStatus());

/** H1: a revoke HIDES the person (record kept, since emptied), still rotates and still deletes its rows now; the pane
 *  lists them under Recently removed; the next publish seals them NOTHING (no row, no padding, no envelope) */
async function hideRevokeCheck(Rx) {
  const Wh = world();
  const rid = (await on(Wh.owner, () => Rx.outbound.createRing("Hide"))).id;
  await on(Wh.owner, () => Rx.outbound.setDepth(rid, Wh.A.id, "posts"));
  const a1 = await address(Rx, Wh.m1);
  const a2 = await address(Rx, Wh.m2);
  const id1 = (await on(Wh.owner, () => Rx.outbound.addMember(rid, a1.address, "Stays"))).memberId;
  const id2 = (await on(Wh.owner, () => Rx.outbound.addMember(rid, a2.address, "Goes"))).memberId;
  const pub1 = await on(Wh.owner, () => Rx.publisher.publishOnce({ force: true }));
  assert(pub1.ok && pub1.real === 2, "positive control, the first publish: " + JSON.stringify(pub1));
  for (const d of [Wh.m1, Wh.m2]) await tickOn(Rx, d);
  assert((await statusOf(Rx, Wh.m2)).rings.length === 1, "positive control: the person about to be removed receives");
  const before = await storedDoc(Rx, Wh.owner);
  const genBefore = before.personas[Wh.A.id].gen;
  const theirRows = before.live.filter((x) => x.owner === rid + "|" + id2).length;
  const dropBefore = dropRows().length;
  const rv = await on(Wh.owner, () => Rx.outbound.revokeMember(rid, id2));
  assert(rv.deleted === true && theirRows === 1 && dropRows().length === dropBefore - 1, "the removed person's row was not deleted at once: " + JSON.stringify(rv));
  const doc = await storedDoc(Rx, Wh.owner);
  const m = doc.rings[rid].members[id2];
  assert(m && m.hiddenAt > 0 && m.label === "Goes" && m.addrId === a2.addrId && /^[0-9a-f]{64}$/.test(m.pskHex), "the removed person's record was not KEPT hidden (hide, never delete): " + JSON.stringify(m && { ...m, pskHex: "…" }));
  assert(Object.keys(m.since).length === 0, "the removed person's key bookkeeping (since) was kept: " + JSON.stringify(m.since));
  assert(doc.personas[Wh.A.id].gen === genBefore + 1 && doc.personas[Wh.A.id].segments.at(-1).start === genBefore + 1, `the key did not rotate to a fresh chain (gen ${genBefore} → ${doc.personas[Wh.A.id].gen})`);
  assert(!doc.live.some((x) => x.owner === rid + "|" + id2), "the removed person's row is still kept in the document");
  const view = await on(Wh.owner, () => Rx.outbound.ringsPaneView());
  const vr = view.rings.find((r) => r.id === rid);
  assert(vr && vr.members.length === 1 && vr.members[0].id === id1, "the pane still lists the removed person among the ring's people: " + JSON.stringify(vr?.members));
  const rm = view.recentlyRemoved.members.find((x) => x.id === id2);
  assert(rm && rm.ringId === rid && rm.ringLabel === "Hide" && rm.label === "Goes" && rm.ref === a2.addrId.slice(0, 8) && rm.hiddenAt === m.hiddenAt, "Recently removed does not list them: " + JSON.stringify(view.recentlyRemoved));
  const vtext = JSON.stringify(view);
  assert(!vtext.includes(m.pskHex) && !vtext.includes(a2.addrId) && !vtext.includes(a2.address.slice(4)), "the pane's view carries a PSK or a full address");
  // the removed person's device drops the record at its next FULL read, and the NEXT publish seals them nothing
  await tickOn(Rx, Wh.m2);
  assert((await statusOf(Rx, Wh.m2)).rings.length === 0, "the removed person's record survived a full read without its row");
  const pub2 = await on(Wh.owner, () => Rx.publisher.publishOnce({ force: true }));
  assert(pub2.ok && pub2.real === 1 && pub2.rows === 4, "the publish after the removal counted the removed person: " + JSON.stringify(pub2));
  await tickOn(Rx, Wh.m2);
  assert((await statusOf(Rx, Wh.m2)).rings.length === 0, "the removed person received an envelope from the publish after the removal");
  await tickOn(Rx, Wh.m1);
  assert((await statusOf(Rx, Wh.m1)).rings.length === 1, "positive control: the person still in the ring receives");
  let again = null;
  try {
    await on(Wh.owner, () => Rx.outbound.revokeMember(rid, id2));
  } catch (e) {
    again = e;
  }
  assert(again && /removed already/.test(again.message), "removing someone already removed was not refused in words: " + again);
  return "record kept, since emptied, rotated, row deleted, sealed nothing";
}
await check("H1 UXH-9 REMOVE HIDES: the person's record is KEPT with hiddenAt (label, address, PSK) and only its key bookkeeping is emptied; the key still rotates and its row is still deleted at once; the pane lists them under Recently removed (no PSK, no address); the next publish seals them NOTHING (real rows and padding count only people in use)", () => hideRevokeCheck(R));

/** H2: keysForMember sends no key to a hidden person or anyone in a hidden ring, even with `since` still set */
async function hiddenKeyCheck(Rx) {
  const Wk = world();
  const rid = (await on(Wk.owner, () => Rx.outbound.createRing("Keys"))).id;
  await on(Wk.owner, () => Rx.outbound.setDepth(rid, Wk.A.id, "posts"));
  const a1 = await address(Rx, Wk.m1);
  await on(Wk.owner, () => Rx.outbound.addMember(rid, a1.address));
  const draft = JSON.parse(JSON.stringify(await on(Wk.owner, () => Rx.model.loadRingsDoc())));
  const r = draft.rings[rid];
  const m = Object.values(r.members)[0];
  assert(Rx.model.keysForMember(draft, r, m, Wk.A.id).length > 0, "positive control: the person in use is sent keys");
  m.hiddenAt = Date.now(); // `since` left in place on purpose: the guard must not rely on it being emptied
  assert(Object.keys(m.since).length > 0 && Rx.model.keysForMember(draft, r, m, Wk.A.id).length === 0, "a removed person (its since still set) was sent a key");
  m.hiddenAt = null;
  r.hiddenAt = Date.now();
  assert(Rx.model.keysForMember(draft, r, m, Wk.A.id).length === 0, "a person in a deleted ring was sent a key");
  assert(Rx.model.visibleMembers(r).length === 0 && Rx.model.visibleRings(draft).every((x) => x.id !== rid), "a deleted ring still shows people in use or counts as in use");
}
await check("H2 UXH-9 a hidden person — or anyone in a deleted ring — is sent NO note key by keysForMember, even with `since` still set (the guard stands on its own, not on the removal emptying since)", () => hiddenKeyCheck(R));

/** H3: a deleted ring is kept whole, not counted toward 16, not "seen" by the composer, sealed nothing */
async function hiddenRingCheck(Rx) {
  const Wd = world();
  const rid = (await on(Wd.owner, () => Rx.outbound.createRing("Gone"))).id;
  await on(Wd.owner, () => Rx.outbound.setDepth(rid, Wd.A.id, "posts"));
  await on(Wd.owner, () => Rx.outbound.setDepth(rid, Wd.B.id, "name"));
  const a1 = await address(Rx, Wd.m1);
  const a2 = await address(Rx, Wd.m2);
  const id1 = (await on(Wd.owner, () => Rx.outbound.addMember(rid, a1.address, "In it"))).memberId;
  const id2 = (await on(Wd.owner, () => Rx.outbound.addMember(rid, a2.address, "Out before"))).memberId;
  await on(Wd.owner, () => Rx.outbound.revokeMember(rid, id2));
  await on(Wd.owner, () => Rx.publisher.publishOnce({ force: true }));
  await tickOn(Rx, Wd.m1);
  assert((await statusOf(Rx, Wd.m1)).rings.length === 1, "positive control: the ring's person receives before the delete");
  assert((await on(Wd.owner, () => Rx.model.noteKeyForPost(Wd.A.id))) !== null, "positive control: a 'posts' ring makes the note real");
  assert((await on(Wd.owner, () => Rx.model.ringsSeeingPosts(Wd.A.id))).join() === "Gone", "positive control: the composer line names the ring");
  const del = await on(Wd.owner, () => Rx.outbound.deleteRing(rid));
  assert(del.deleteError === null, "the deleted ring's rows were not deleted: " + JSON.stringify(del));
  const doc = await storedDoc(Rx, Wd.owner);
  const r = doc.rings[rid];
  assert(r && r.hiddenAt > 0 && r.label === "Gone" && r.depths[Wd.A.id] === "posts" && r.depths[Wd.B.id] === "name", "the deleted ring was not KEPT whole (name, what it sees): " + JSON.stringify(r && { ...r, members: "…" }));
  assert(r.members[id1]?.hiddenAt === null && r.members[id2]?.hiddenAt > 0 && Object.values(r.members).every((m) => Object.keys(m.since).length === 0), "the deleted ring's people were not kept as they were (in it / removed before), or kept their key bookkeeping");
  const view = await on(Wd.owner, () => Rx.outbound.ringsPaneView());
  assert(!view.rings.some((x) => x.id === rid), "the pane still lists the deleted ring among the rings in use");
  const vr = view.recentlyRemoved.rings.find((x) => x.id === rid);
  assert(vr && vr.label === "Gone" && vr.people === 1 && vr.hiddenAt === r.hiddenAt, "Recently removed does not list the ring with the 1 person who comes back with it: " + JSON.stringify(view.recentlyRemoved.rings));
  assert(!view.recentlyRemoved.members.some((x) => x.ringId === rid), "people inside a deleted ring are listed on their own");
  // NOT "seen": the composer makes a random note again, and its line names no ring
  assert((await on(Wd.owner, () => Rx.model.noteKeyForPost(Wd.A.id))) === null, "a deleted ring still makes the persona's note real (it is 'seen')");
  assert((await on(Wd.owner, () => Rx.model.ringsSeeingPosts(Wd.A.id))).length === 0, "the composer line still names the deleted ring");
  const ch = hex(32);
  const n = await on(Wd.owner, () => Rx.note.noteForPost("fixture", Wd.A.id, ch));
  const k = doc.personas[Wd.A.id];
  assert(n.length === 512 && Rx.note.openNoteWith(n, ch, Rx.model.currentNoteKey(k)) === null, "the note after the delete opens under the persona's key");
  // sealed nothing: the people of a deleted ring receive nothing from the next publish
  await tickOn(Rx, Wd.m1);
  assert((await statusOf(Rx, Wd.m1)).rings.length === 0, "the deleted ring's person still reads its note after the delete");
  const pub = await on(Wd.owner, () => Rx.publisher.publishOnce({ force: true }));
  assert(pub.ok && (pub.real ?? 0) === 0, "the publish after the delete sealed rows to the deleted ring's people: " + JSON.stringify(pub));
  await tickOn(Rx, Wd.m1);
  assert((await statusOf(Rx, Wd.m1)).rings.length === 0, "the deleted ring's person received an envelope after the delete");
  // NOT counted toward 16: sixteen new rings fit beside it, the seventeenth is refused
  for (let i = 0; i < Rx.model.MAX_RINGS; i++) await on(Wd.owner, () => Rx.outbound.createRing("Fill " + i));
  let refused = null;
  try {
    await on(Wd.owner, () => Rx.outbound.createRing("One too many"));
  } catch (e) {
    refused = e;
  }
  assert(refused && /16 rings/.test(refused.message), "a seventeenth ring in use was not refused: " + refused);
  // a deleted ring is changed only by restoring it
  let changed = null;
  try {
    await on(Wd.owner, () => Rx.outbound.setDepth(rid, Wd.C.id, "name"));
  } catch (e) {
    changed = e;
  }
  assert(changed && /deleted — restore it from Recently removed first/.test(changed.message), "a deleted ring could still be changed: " + changed);
}
await check("H3 UXH-9 DELETE RING HIDES: the ring is KEPT whole (name, depths, its people, the one removed before still removed) and listed under Recently removed with how many come back; it is NOT 'seen' (random note again, the composer line names nothing), sealed nothing, and NOT counted toward 16 (sixteen new rings fit beside it); a deleted ring can only be restored", () => hiddenRingCheck(R));

/** H4: restoring a person is a JOIN — since moves to a NEW generation, so the window they were removed stays closed */
async function restoreMemberCheck(Rx) {
  const Wr = world();
  const rid = (await on(Wr.owner, () => Rx.outbound.createRing("Back"))).id;
  await on(Wr.owner, () => Rx.outbound.setDepth(rid, Wr.A.id, "posts"));
  const a1 = await address(Rx, Wr.m1);
  const a2 = await address(Rx, Wr.m2);
  await on(Wr.owner, () => Rx.outbound.addMember(rid, a1.address, "Mia"));
  const id2 = (await on(Wr.owner, () => Rx.outbound.addMember(rid, a2.address, "Max"))).memberId;
  const pre = await anonPost(Rx, Wr.owner, Wr.A, "before the removal " + hex(3));
  await on(Wr.owner, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [Wr.m1, Wr.m2]) await tickOn(Rx, d);
  assert((await reveal(Rx, Wr.m2, pre.castHash))?.persona.handle === Wr.A.handle, "positive control: m2 opens the post made before its removal");
  await on(Wr.owner, () => Rx.outbound.revokeMember(rid, id2));
  const during = await anonPost(Rx, Wr.owner, Wr.A, "while m2 is removed " + hex(3));
  const genDuring = (await storedDoc(Rx, Wr.owner)).personas[Wr.A.id].gen;
  await on(Wr.owner, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [Wr.m1, Wr.m2]) await tickOn(Rx, d);
  assert((await reveal(Rx, Wr.m1, during.castHash))?.persona.handle === Wr.A.handle, "positive control: m1 opens the post made while m2 was removed");
  assert((await reveal(Rx, Wr.m2, during.castHash)) === null, "m2 opens a post made while it was removed (before the restore)");
  const rs = await on(Wr.owner, () => Rx.outbound.restoreMember(rid, id2));
  assert(rs.restored === true, "restoreMember: " + JSON.stringify(rs));
  const doc = await storedDoc(Rx, Wr.owner);
  const m = doc.rings[rid].members[id2];
  const view = await on(Wr.owner, () => Rx.outbound.ringsPaneView());
  assert(view.rings.find((r) => r.id === rid)?.members.some((x) => x.id === id2) && !view.recentlyRemoved.members.some((x) => x.id === id2), "the pane does not show m2 back in the ring");
  const after = await anonPost(Rx, Wr.owner, Wr.A, "after the restore " + hex(3));
  await on(Wr.owner, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [Wr.m1, Wr.m2]) await tickOn(Rx, d);
  assert((await reveal(Rx, Wr.m2, after.castHash))?.persona.handle === Wr.A.handle, "the restored person does not open a post made after the restore");
  assert((await reveal(Rx, Wr.m2, during.castHash)) === null, "THE REMOVED WINDOW REOPENED: the restored person opens a post made while it was removed");
  const keys = (await on(Wr.m2, () => Rx.received.receivedNoteKeysForDebug())).map((x) => x.keyHex);
  assert(keys.length > 0 && Rx.note.openNote(during.note, during.castHash, keys) === null, "the restored person's keys open a post made while it was removed");
  assert((await reveal(Rx, Wr.m2, pre.castHash)) === null, "the restored person is shown a post from before its removal (it starts from the restore)");
  // the behaviour above first (a broken copy must fail on what the person SEES), then the bookkeeping behind it
  assert(m && m.hiddenAt === null && m.label === "Max" && m.since[Wr.A.id] > genDuring, `the restore did not start m2 at a NEW generation (since ${m && m.since[Wr.A.id]}, the removed window used ${genDuring})`);
  for (const p of [pre, during, after]) assert((await reveal(Rx, Wr.m1, p.castHash))?.persona.handle === Wr.A.handle, "the person who stayed lost a post: " + p.castHash.slice(0, 8));
  assert((await on(Wr.owner, () => Rx.outbound.restoreMember(rid, id2))).restored === false, "restoring someone already back changed something");
  // adding back a removed ADDRESS restores the same record (one record per address), from now on as well
  await on(Wr.owner, () => Rx.outbound.revokeMember(rid, id2));
  const count = Object.keys((await storedDoc(Rx, Wr.owner)).rings[rid].members).length;
  const genAgain = (await storedDoc(Rx, Wr.owner)).personas[Wr.A.id].gen;
  const re = await on(Wr.owner, () => Rx.outbound.addMember(rid, a2.address, "Max again"));
  const doc2 = await storedDoc(Rx, Wr.owner);
  assert(re.restored === true && re.memberId === id2 && Object.keys(doc2.rings[rid].members).length === count && doc2.rings[rid].members[id2].label === "Max again" && doc2.rings[rid].members[id2].hiddenAt === null && doc2.rings[rid].members[id2].since[Wr.A.id] > genAgain, "adding back a removed address did not restore its one record from now on: " + JSON.stringify(re));
}
await check("H4 UXH-9 RESTORE A PERSON is a JOIN: they start at a NEW generation (since = now), so they open posts made after the restore and NOT the ones made while they were removed (by render or by key), nor the ones from before; the people who stayed lose nothing; restoring twice changes nothing; adding back a removed address restores its one record", () => restoreMemberCheck(R));

/** H5: restoring a ring brings back its name, depths and the people in it at the delete (not those removed before),
 *  as ONE join; refused in words on a name clash */
async function restoreRingCheck(Rx) {
  const Wg = world();
  const rid = (await on(Wg.owner, () => Rx.outbound.createRing("Again"))).id;
  const keep = (await on(Wg.owner, () => Rx.outbound.createRing("Keep"))).id;
  for (const x of [rid, keep]) await on(Wg.owner, () => Rx.outbound.setDepth(x, Wg.A.id, "posts"));
  const a1 = await address(Rx, Wg.m1);
  const a2 = await address(Rx, Wg.m2);
  const an = await address(Rx, Wg.n1);
  const id1 = (await on(Wg.owner, () => Rx.outbound.addMember(rid, a1.address, "Comes back"))).memberId;
  const id2 = (await on(Wg.owner, () => Rx.outbound.addMember(rid, a2.address, "Stays out"))).memberId;
  await on(Wg.owner, () => Rx.outbound.addMember(keep, an.address));
  await on(Wg.owner, () => Rx.outbound.revokeMember(rid, id2));
  await on(Wg.owner, () => Rx.outbound.deleteRing(rid));
  // a post while the ring is deleted is REAL (the other ring still sees @alice), at the current generation
  const during = await anonPost(Rx, Wg.owner, Wg.A, "while the ring is deleted " + hex(3));
  const genDuring = (await storedDoc(Rx, Wg.owner)).personas[Wg.A.id].gen;
  await on(Wg.owner, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [Wg.m1, Wg.n1]) await tickOn(Rx, d);
  assert((await reveal(Rx, Wg.n1, during.castHash))?.persona.handle === Wg.A.handle, "positive control: the other ring's person opens the post made while this ring was deleted");
  assert((await reveal(Rx, Wg.m1, during.castHash)) === null, "a deleted ring's person opens a post made while it was deleted");
  // a deleted ring's name is free; restoring it then asks for one of the two to be renamed first
  const clash = (await on(Wg.owner, () => Rx.outbound.createRing("again"))).id;
  let refused = null;
  try {
    await on(Wg.owner, () => Rx.outbound.restoreRing(rid));
  } catch (e) {
    refused = e;
  }
  assert(refused && /already have a ring named "Again" — rename that one first/.test(refused.message), "a restore onto a name in use was not refused in words: " + refused);
  await on(Wg.owner, () => Rx.outbound.renameRing(clash, "Other"));
  const rs = await on(Wg.owner, () => Rx.outbound.restoreRing(rid));
  assert(rs.restored === true, "restoreRing: " + JSON.stringify(rs));
  const doc = await storedDoc(Rx, Wg.owner);
  const r = doc.rings[rid];
  assert(r.hiddenAt === null && r.label === "Again" && r.depths[Wg.A.id] === "posts", "the ring did not come back with its name and what it sees");
  assert(r.members[id1].hiddenAt === null, "the ring's person did not come back with it");
  assert(r.members[id2].hiddenAt > 0 && Object.keys(r.members[id2].since).length === 0, "the person removed BEFORE the delete came back with the ring");
  const view = await on(Wg.owner, () => Rx.outbound.ringsPaneView());
  assert(view.rings.find((x) => x.id === rid)?.members.map((x) => x.id).join() === id1 && !view.recentlyRemoved.rings.some((x) => x.id === rid) && view.recentlyRemoved.members.some((x) => x.id === id2), "the pane after the restore: " + JSON.stringify(view.recentlyRemoved));
  const after = await anonPost(Rx, Wg.owner, Wg.A, "after the ring came back " + hex(3));
  await on(Wg.owner, () => Rx.publisher.publishOnce({ force: true }));
  for (const d of [Wg.m1, Wg.m2, Wg.n1]) await tickOn(Rx, d);
  assert((await reveal(Rx, Wg.m1, after.castHash))?.persona.handle === Wg.A.handle, "the restored ring's person does not open a post made after the restore");
  assert((await reveal(Rx, Wg.m1, during.castHash)) === null, "THE DELETED WINDOW REOPENED: the restored ring's person opens a post made while it was deleted");
  // the behaviour above first, then the bookkeeping behind it
  assert(r.members[id1].since[Wg.A.id] > genDuring, `the ring's person did not come back at a NEW generation (since ${r.members[id1].since[Wg.A.id]}, the deleted window used ${genDuring})`);
  assert((await statusOf(Rx, Wg.m2)).rings.length === 0, "the person removed before the delete receives again after the ring's restore");
  assert((await reveal(Rx, Wg.n1, after.castHash))?.persona.handle === Wg.A.handle && (await reveal(Rx, Wg.n1, during.castHash))?.persona.handle === Wg.A.handle, "the other ring's person lost a post");
  assert((await on(Wg.owner, () => Rx.outbound.restoreRing(rid))).restored === false, "restoring a ring already back changed something");
}
await check("H5 UXH-9 RESTORE A RING: it comes back with its name, what it sees and the people in it at the delete — not the one removed before — as ONE join (a NEW generation: a post made while it was deleted stays closed to them, one made after opens); a name in use refuses in words until one is renamed; restoring twice changes nothing", () => restoreRingCheck(R));

/** the mock vault's sealing (MOCKS["lib/vault/vault"].encryptNamespace), for writing a document by hand */
function sealDocInto(dev, m) {
  const plain = JSON.stringify({ m, pad: "" });
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(dev.vaultKey), nonce);
  c.setAAD(Buffer.from("rings|_"));
  const ct = Buffer.concat([c.update(Buffer.from(plain)), c.final(), c.getAuthTag()]);
  dev.vault.set("rings", { _: { v: 1, ns: "rings", id: "_", nonce: nonce.toString("hex"), ct: ct.toString("hex") } });
}
/** the stored document as sealed, decrypted past the parser (the mock vault's key and AAD) */
function rawDocOf(dev) {
  const rec = dev.vault.get("rings")._;
  const buf = Buffer.from(rec.ct, "hex");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(dev.vaultKey), Buffer.from(rec.nonce, "hex"));
  d.setAAD(Buffer.from("rings|_"));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString()).m;
}
/** H6: the parser — an old (version 1) document reads as nothing hidden; a mark it cannot read is REFUSED, never "in use" */
async function parserCheck(Rx) {
  const Wp = world();
  const a1 = await address(Rx, Wp.m1);
  const k = Rx.envelope.parseAddress(a1.address);
  const now = Date.now();
  const v1 = (ringExtra = {}, memberExtra = {}) => ({
    v: 1,
    rev: 3,
    sealId: "abcdabcdabcdabcd",
    rings: { r1: { id: "r1", label: "Old", createdAt: now - 5000, depths: { [Wp.A.id]: "name" }, members: { mm1: { id: "mm1", kind: "address", addrId: k.addrId, pkHex: k.pkHex, pskHex: k.pskHex, label: null, addedAt: now - 4000, seq: 0, since: {}, ...memberExtra } }, shareAs: null, ...ringExtra } },
    personas: {},
    inbox: {},
    live: [],
    publish: { gen: 0, lastPublishAt: null, nextDueAt: null, dirty: false, lastError: null, lastRows: 0 },
    createdAt: now - 6000,
  });
  const load = () =>
    on(Wp.owner, async () => {
      Rx.model.resetRingsDocCache();
      return Rx.model.loadRingsDoc();
    });
  sealDocInto(Wp.owner, v1());
  const doc = await load();
  assert(doc.v === 2 && doc.rings.r1.hiddenAt === null && doc.rings.r1.members.mm1.hiddenAt === null, "an old document did not read as nothing hidden: " + JSON.stringify({ v: doc.v, r: doc.rings.r1.hiddenAt, m: doc.rings.r1.members.mm1.hiddenAt }));
  const pv = await on(Wp.owner, () => Rx.outbound.ringsPaneView());
  assert(pv.rings.length === 1 && pv.rings[0].members.length === 1 && pv.recentlyRemoved.rings.length === 0 && pv.recentlyRemoved.members.length === 0, "an old document's ring or person is not shown as in use");
  const pub = await on(Wp.owner, () => Rx.publisher.publishOnce({ force: true }));
  assert(pub.ok && pub.real === 1, "an old document's person is not sealed its note: " + JSON.stringify(pub));
  // the RAW stored record (the parser always answers version 2, so it is read past the parser here)
  const written = rawDocOf(Wp.owner);
  assert(written.v === 2 && written.rings.r1.hiddenAt === null && written.rings.r1.members.mm1.hiddenAt === null, "the publish did not write the document back as version 2 with every mark explicit: " + JSON.stringify({ v: written.v, r: written.rings.r1.hiddenAt }));
  const bads = [
    ["a ring hidden as text", { hiddenAt: "yesterday" }, {}],
    ["a person hidden as a negative number", {}, { hiddenAt: -5 }],
    ["a person hidden as zero", {}, { hiddenAt: 0 }],
    ["a ring hidden as a fraction", { hiddenAt: 1.5 }, {}],
    ["a person hidden as true", {}, { hiddenAt: true }],
  ];
  for (const [what, re, me] of bads) {
    sealDocInto(Wp.owner, v1(re, me));
    let threw = null;
    try {
      await load();
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.name === "RingsUnread" && /"removed" mark can't be read/.test(threw.message), what + " was read (as in use, or silently) instead of refused: " + (threw ? threw.message : "no refusal"));
  }
  sealDocInto(Wp.owner, { ...v1(), v: 3 });
  let v3 = null;
  try {
    await load();
  } catch (e) {
    v3 = e;
  }
  assert(v3 && /none readable by this device/.test(v3.message), "a version 3 document was read: " + v3);
  return "v1 → nothing hidden; 5 unreadable marks refused; v3 refused";
}
await check("H6 UXH-9 THE PARSER: an old (version 1) document reads as NOTHING hidden (shown, sealed, written back as version 2); an unreadable 'removed' mark (text, negative, zero, a fraction, true) is REFUSED loudly, never read as 'in use'; an unknown version is refused", () => parserCheck(R));
await check("H6b UXH-9 a device still running the VERSION 1 code refuses a version 2 document ('none readable by this device'): a stale tab across a deploy fails closed instead of re-sealing to someone removed", async () => {
  const Old = await bundle({ "lib/rings/model.ts": [["(rec.m.v !== 1 && rec.m.v !== RINGS_DOC_V)", "rec.m.v !== 1"]] });
  const Wo = world();
  await on(Wo.owner, () => R.outbound.createRing("Written by the new code"));
  let threw = null;
  try {
    await on(Wo.owner, async () => {
      Old.model.resetRingsDocCache();
      await Old.model.loadRingsDoc();
    });
  } catch (e) {
    threw = e;
  }
  assert(threw && /none readable by this device/.test(threw.message), "version 1 code read a version 2 document: " + (threw ? threw.message : "it read it"));
});

/** H7: the record bounds refuse a NEW ring or person in plain words; a removal is never refused; nothing is dropped */
async function boundsCheck(Rx) {
  const Wb = world();
  const M = Rx.model;
  const firsts = [];
  for (let i = 0; i < M.MAX_RINGS; i++) firsts.push((await on(Wb.owner, () => Rx.outbound.createRing("First " + i))).id);
  for (const id of firsts) await on(Wb.owner, () => Rx.outbound.deleteRing(id));
  const seconds = [];
  for (let i = 0; i < M.MAX_RINGS; i++) seconds.push((await on(Wb.owner, () => Rx.outbound.createRing("Second " + i))).id);
  assert(Object.keys((await storedDoc(Rx, Wb.owner)).rings).length === M.MAX_RING_RECORDS, "the ring records are not at their bound");
  await on(Wb.owner, () => Rx.outbound.deleteRing(seconds[0])); // a delete AT the bound: never refused
  let ringRefused = null;
  try {
    await on(Wb.owner, () => Rx.outbound.createRing("Third"));
  } catch (e) {
    ringRefused = e;
  }
  assert(ringRefused && ringRefused.message === Rx.outbound.RING_RECORDS_FULL && /out of room for rings/.test(ringRefused.message), "a new ring past the record bound was not refused in words: " + ringRefused);
  const after = await storedDoc(Rx, Wb.owner);
  assert(Object.keys(after.rings).length === M.MAX_RING_RECORDS && Object.values(after.rings).filter((r) => r.hiddenAt > 0).length === M.MAX_RINGS + 1, "a ring record was dropped to make room (hide, never delete)");
  assert((await on(Wb.owner, () => Rx.outbound.restoreRing(firsts[0]))).restored === true, "restoring at the record bound was refused (it adds no record)");
  let full16 = null;
  try {
    await on(Wb.owner, () => Rx.outbound.restoreRing(firsts[1]));
  } catch (e) {
    full16 = e;
  }
  assert(full16 && /already have 16 rings in use — delete one first/.test(full16.message), "a restore past 16 rings in use was not refused in words: " + full16);
  // people: 32 in use and 64 records per ring
  const a1 = await address(Rx, Wb.m1);
  const ids = [(await on(Wb.owner, () => Rx.outbound.addMember(seconds[1], a1.address, "By address"))).memberId];
  for (let i = 1; i < M.MAX_MEMBERS_PER_RING; i++) ids.push((await on(Wb.owner, () => Rx.outbound.makeLink(seconds[1]))).memberId);
  let over = null;
  try {
    await on(Wb.owner, () => Rx.outbound.makeLink(seconds[1]));
  } catch (e) {
    over = e;
  }
  assert(over && /at most 32 people/.test(over.message), "a 33rd person in use was not refused: " + over);
  for (const id of ids) await on(Wb.owner, () => Rx.outbound.revokeMember(seconds[1], id));
  const ids2 = [];
  for (let i = 0; i < M.MAX_MEMBERS_PER_RING; i++) ids2.push((await on(Wb.owner, () => Rx.outbound.makeLink(seconds[1]))).memberId);
  assert(Object.keys((await storedDoc(Rx, Wb.owner)).rings[seconds[1]].members).length === M.MAX_MEMBER_RECORDS_PER_RING, "the person records are not at their bound");
  await on(Wb.owner, () => Rx.outbound.revokeMember(seconds[1], ids2[0])); // a removal AT the bound: never refused
  let memberRefused = null;
  try {
    await on(Wb.owner, () => Rx.outbound.makeLink(seconds[1]));
  } catch (e) {
    memberRefused = e;
  }
  assert(memberRefused && /is out of room: a ring keeps 64 people, counting the ones you removed/.test(memberRefused.message), "a new person past the record bound was not refused in words: " + memberRefused);
  const fresh = await address(Rx, Wb.m2);
  let addRefused = null;
  try {
    await on(Wb.owner, () => Rx.outbound.addMember(seconds[1], fresh.address));
  } catch (e) {
    addRefused = e;
  }
  assert(addRefused && /is out of room/.test(addRefused.message), "a new address past the record bound was not refused in words: " + addRefused);
  const back = await on(Wb.owner, () => Rx.outbound.addMember(seconds[1], a1.address));
  assert(back.restored === true && back.memberId === ids[0], "adding back a removed address at the record bound was refused (it adds no record): " + JSON.stringify(back));
  let ringFull = null;
  try {
    await on(Wb.owner, () => Rx.outbound.restoreMember(seconds[1], ids[1]));
  } catch (e) {
    ringFull = e;
  }
  assert(ringFull && /already holds 32 people — remove someone first/.test(ringFull.message), "a restore into a full ring was not refused in words: " + ringFull);
  const doc = await storedDoc(Rx, Wb.owner);
  const members = doc.rings[seconds[1]].members;
  assert(Object.keys(members).length === M.MAX_MEMBER_RECORDS_PER_RING && inUse(members).length === M.MAX_MEMBERS_PER_RING, "a person record was dropped to make room (hide, never delete)");
  return "rings 32 records, people 64 records";
}
await check("H7 UXH-9 THE BOUNDS: hidden records count toward MAX_RING_RECORDS (32) and MAX_MEMBER_RECORDS_PER_RING (64), not toward 16 rings / 32 people in use; past them a NEW ring or person is refused in plain words, a delete or removal AT the bound is never refused, a restore (or adding back a removed address) still works, nothing is ever dropped to make room; a restore past 16 rings or 32 people in use is refused in words", () => boundsCheck(R));

/** H8: the route and the pane — the restore actions, Recently removed, the sentence beside Restore, the confirms */
function hideSeams(paneSrc, routeSrc) {
  for (const a of ["restoreMember", "restoreRing"]) {
    const at = routeSrc.indexOf(`case "${a}":`);
    assert(at > 0 && routeSrc.slice(at, at + 200).includes(`await out.${a}(`), "the route has no " + a + " action");
  }
  assert(/recentlyRemoved: view\.recentlyRemoved/.test(routeSrc), "GET /api/rings does not carry Recently removed");
  assert(/RESTORE_MEMBER_LINE = "They will see posts from now on, not the ones made while they were removed\."/.test(paneSrc), "the restore sentence is not the plain one");
  const box = paneSrc.slice(paneSrc.indexOf('data-testid="rings-recently-removed"'), paneSrc.indexOf('data-testid="rings-recently-removed"') + 6000);
  assert(paneSrc.includes('<SettingsGroup title="Recently removed"') && box.length > 1000, "no Recently removed section");
  assert(/data-testid="member-restore"/.test(box) && /action: "restoreMember", ringId: m\.ringId, memberId: m\.id/.test(box), "no Restore button for a removed person");
  assert(/data-testid="ring-restore"/.test(box) && /action: "restoreRing", ringId: r\.id/.test(box), "no Restore button for a deleted ring");
  assert(/data-testid="rings-restore-line"[^>]*>\s*\{RESTORE_MEMBER_LINE\}/.test(box), "the restore sentence is not shown beside the Restore buttons");
  for (const [fn, kept] of [["export const revokeConfirm", "REMOVED_KEPT"], ["export const deleteRingConfirm", "DELETED_KEPT"]]) {
    const body = paneSrc.slice(paneSrc.indexOf(fn), paneSrc.indexOf(fn) + 500);
    assert(body.includes("${" + kept + "}") && /Your other devices stop using the old key at their next check, within about 25 minutes\./.test(body), fn + " does not say where a removal goes (or lost the L6 sentence)");
  }
}
await check("H8 UXH-9 the seams: the route's restoreMember / restoreRing actions and GET's recentlyRemoved; the pane's Settings › Rings › Recently removed with a Restore for a person and for a ring, the plain sentence beside them ('They will see posts from now on, not the ones made while they were removed.'); Remove and Delete say where it goes and keep the L6 sentence", () =>
  hideSeams(readFileSync(path.join(ROOT, "components/settings/RingsPane.tsx"), "utf8"), readFileSync(path.join(ROOT, "app/api/rings/route.ts"), "utf8"))
);

/** H9: a ring SKIPPED by a publish (its note no longer fits) keeps the rows of its people in use only — a removed
 *  person's row that a failed delete left behind is deleted by that publish's swap anyway */
async function skippedRingRemovedRowCheck(Rx) {
  worldSeq++;
  const tag = "s" + worldSeq;
  const many = newDevice("skip" + tag, {
    root: ROOT_FACE,
    personas: Array.from({ length: 16 }, (_, i) => ({ id: "p_skip_" + i + "_" + tag, kind: "public", handle: ("skiphandle" + i + "_" + tag).padEnd(64, "x"), name: ("Skip Persona " + i).padEnd(48, "y"), avatarUrl: null })),
  });
  const big = (await on(many, () => Rx.outbound.createRing("Big"))).id;
  const ms = newDevice("skipstay" + tag);
  const mx = newDevice("skipgone" + tag);
  const as = await address(Rx, ms);
  const ax = await address(Rx, mx);
  await on(many, () => Rx.outbound.addMember(big, as.address));
  const gone = (await on(many, () => Rx.outbound.addMember(big, ax.address))).memberId;
  await on(many, () => Rx.outbound.setDepth(big, many.personas[0].id, "posts"));
  const first = await on(many, () => Rx.publisher.publishOnce({ force: true }));
  assert(first.ok && first.real === 2 && !first.skippedRings, "positive control, the first publish: " + JSON.stringify(first));
  for (const d of [ms, mx]) await tickOn(Rx, d);
  assert((await statusOf(Rx, mx)).rings.length === 1, "positive control: the person about to be removed receives");
  // pushed past the envelope after the up-front check (as a persona rename would), straight into the document
  await on(many, () => Rx.model.mutateRingsDoc((d) => {
    for (const p of many.personas) {
      if (d.rings[big].depths[p.id] === "posts") continue;
      d.rings[big].depths[p.id] = "posts";
      const g = Rx.model.advance(d, p.id);
      for (const m of Object.values(d.rings[big].members)) m.since[p.id] = g;
    }
  }));
  // the removal's delete FAILS (the drop refuses): the row stays, kept in the document for a later publish to delete
  RU.putFail = 503;
  let rv;
  try {
    rv = await on(many, () => Rx.outbound.revokeMember(big, gone));
  } finally {
    RU.putFail = null;
  }
  const goneRow = (await storedDoc(Rx, many)).live.find((x) => x.owner === big + "|" + gone);
  assert(rv.deleted === false && goneRow && dropRows().some((r) => r.id === goneRow.rowId), "positive control: the failed delete left the removed person's row on the drop: " + JSON.stringify(rv));
  const second = await on(many, () => Rx.publisher.publishOnce({ force: true }));
  assert(second.ok && (second.skippedRings ?? []).join() === "Big", "the ring was not skipped (the setup did not overflow it): " + JSON.stringify(second));
  assert(!dropRows().some((r) => r.id === goneRow.rowId), "the removed person's row was KEPT because its ring was skipped (it outlives the removal until the ring fits again)");
  for (const d of [ms, mx]) await tickOn(Rx, d);
  assert((await statusOf(Rx, mx)).rings.length === 0, "the removed person still reads its note after the publish");
  assert((await statusOf(Rx, ms)).rings.length === 1, "positive control: the skipped ring's person still in use keeps its last note");
}
await check("H9 UXH-9 a ring SKIPPED by a publish (its note no longer fits) keeps only the rows of its people in use: a removed person's row that a failed delete left behind is deleted by that publish anyway, while the person still in it keeps the last note", () => skippedRingRemovedRowCheck(R));

// ================================================================================================ V — the validator in process
console.log("\nV — the drop's write rules, through the real validator");
async function validatorRules(base) {
  const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const sealed = await R.envelope.sealStatement(statement(k.addrId), k);
  const rowOf = () => ({ id: hex(16), enc: sealed.enc, ct: sealed.ct, hint: sealed.hint, expiresHour: hourNow() + 10, delHash: R.envelope.delHashOf(hex(32)) });
  const rows = (n) => Array.from({ length: n }, rowOf);
  const put = async (body, signed = true) => {
    const text = JSON.stringify(body);
    const dev = RU.cur ?? newDevice("vrules");
    const headers = { "content-type": "application/json", ...(signed ? await (async () => {
      await registerDevice(dev, base);
      dev.counter += 1;
      const h = createHash("sha256").update(text).digest("hex");
      return { "x-layers-device": dev.deviceId, "x-layers-counter": String(dev.counter), "x-layers-sig": edSignHex(["layers-envelope/1", "rings:drop", h, String(dev.counter)].join("|"), dev.devKey) };
    })() : {}) };
    return (await realFetch(base + "/rings/drop/batch", { method: "PUT", headers, body: text })).status;
  };
  use(newDevice("vrules"));
  const unsigned = await put({ rows: rows(4), deletes: [] }, false);
  const three = await put({ rows: rows(3), deletes: [] });
  const four = await put({ rows: rows(4), deletes: [] });
  assert(unsigned === 401, "unsigned: " + unsigned);
  assert(three === 400, "3 rows: " + three);
  assert(four === 201, "positive control, a signed batch of 4: " + four);
}
await check("V1 the real validator: an unsigned write 401, a signed batch of 3 400, a signed batch of 4 201 (the positive control)", () => validatorRules(V.base));
/** W2-RINGS-DROP-FILL-DOS: one device cannot keep more than its share live; a swap that nets to zero still fits */
async function occupancyRule(base) {
  const prev = process.env.RING_DROP_MAX_LIVE_PER_DEVICE;
  process.env.RING_DROP_MAX_LIVE_PER_DEVICE = "8";
  try {
    const k = await R.envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
    const sealed = await R.envelope.sealStatement(statement(k.addrId), k);
    const mk = (n) =>
      Array.from({ length: n }, () => {
        const token = hex(32);
        return { row: { id: hex(16), enc: sealed.enc, ct: sealed.ct, hint: sealed.hint, expiresHour: hourNow() + 10, delHash: R.envelope.delHashOf(token) }, token };
      });
    const dev = newDevice("occupy");
    const put = async (body) => {
      const text = JSON.stringify(body);
      await registerDevice(dev, base);
      dev.counter += 1;
      const h = createHash("sha256").update(text).digest("hex");
      const headers = { "content-type": "application/json", "x-layers-device": dev.deviceId, "x-layers-counter": String(dev.counter), "x-layers-sig": edSignHex(["layers-envelope/1", "rings:drop", h, String(dev.counter)].join("|"), dev.devKey) };
      return (await realFetch(base + "/rings/drop/batch", { method: "PUT", headers, body: text })).status;
    };
    const gen1 = mk(8);
    assert((await put({ rows: gen1.map((x) => x.row), deletes: [] })) === 201, "positive control: 8 rows within the device's share");
    assert((await put({ rows: mk(4).map((x) => x.row), deletes: [] })) === 429, "a device kept more rows live than its share (the drop could be filled by one device)");
    const gen2 = mk(8);
    assert((await put({ rows: gen2.map((x) => x.row), deletes: gen1.map((x) => x.token) })) === 201, "a swap that takes out as many as it puts in was refused");
    assert((await put({ rows: [], deletes: gen2.slice(0, 4).map((x) => x.token) })) === 201, "a delete-only write was refused");
    assert((await put({ rows: mk(4).map((x) => x.row), deletes: [] })) === 201, "rows freed by a delete were not usable again");
  } finally {
    if (prev === undefined) delete process.env.RING_DROP_MAX_LIVE_PER_DEVICE;
    else process.env.RING_DROP_MAX_LIVE_PER_DEVICE = prev;
  }
}
await check("V3 W2-RINGS-DROP-FILL-DOS the real validator bounds OCCUPANCY per device: past its share of live rows a write is 429; the publisher's swap (as many out as in) still fits; deleting frees room again", () => occupancyRule(V.base));
await check("V2 the drop table has exactly six columns and no writer, device, anchor or mode column", () => {
  const cols = V.db.prepare("PRAGMA table_info(ring_drop)").all().map((c) => c.name).sort().join();
  assert(cols === "ct,del_hash,enc,expires_hour,hint,id", cols);
});

// ================================================================================================ L — the leak grep
console.log("\nL — the leak grep");
await check("L1 U13: no persona id, Totem handle, ring or member label, address id, PSK, inbox material, note key or root name in ANY request outside the sealed ct, ANY validator table outside ring_drop.ct, or the sealed vault bytes", async () => {
  const needles = new Map();
  const add = (v, label) => {
    if (typeof v === "string" && v.length >= 5) needles.set(v, label);
  };
  for (const p of W.owner.personas) {
    add(p.id, "persona id");
    add(p.handle, "persona handle");
  }
  add("Inner", "ring label");
  add("Mia", "member label");
  add("Max", "member label");
  add("Rooty Root", "root display name");
  add("rootyfname", "root fname");
  for (const d of [W.owner, W.m1, W.m2, W.n1]) {
    const sec = await on(d, async () => R.model.ringsDocSecretsForLeakTest(await R.model.loadRingsDoc()));
    for (const x of sec.pskHex) add(x, d.name + " member PSK");
    for (const x of sec.noteKeys) add(x, d.name + " note key");
    for (const x of sec.addrIds) add(x, d.name + " address id");
    for (const x of sec.nonces) add(x, d.name + " inbox nonce");
    for (const x of await on(d, () => R.inbox.inboxMaterialForLeakTest())) add(x, d.name + " inbox material");
    for (const k of await on(d, () => R.received.receivedNoteKeysForDebug())) add(k.keyHex, d.name + " received note key");
  }
  assert(needles.size > 30, "too few needles: " + needles.size);
  const hits = [];
  // every request: url, headers, body — with each row's ct and the anon note blanked
  for (const r of RU.requests) {
    let body = r.body;
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j.rows)) for (const row of j.rows) row.ct = "";
      body = JSON.stringify(j);
    } catch {}
    const text = r.url + JSON.stringify(r.headers) + body;
    for (const [n, label] of needles) if (text.includes(n)) hits.push(`request ${r.method} ${r.url}: ${label}`);
  }
  // every validator table, every column but ring_drop.ct
  for (const { name } of V.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    for (const row of V.db.prepare(`SELECT * FROM "${name}"`).all()) {
      const o = { ...row };
      if (name === "ring_drop") delete o.ct;
      if (name === "zk_anon_casts") delete o.note;
      const text = JSON.stringify(o);
      for (const [n, label] of needles) if (text.includes(n)) hits.push(`table ${name}: ${label}`);
    }
  }
  // the sealed vault bytes
  for (const d of [W.owner, W.m1, W.m2, W.n1]) {
    const text = JSON.stringify(d.vault.get("rings") ?? {});
    for (const [n, label] of needles) if (text.includes(n)) hits.push(`${d.name}'s sealed vault: ${label}`);
  }
  // the anon notes themselves carry no needle either
  for (const c of RU.anonCasts) for (const [n, label] of needles) if (c.note.includes(n)) hits.push("an anon note: " + label);
  assert(hits.length === 0, hits.slice(0, 6).join("; "));
  return `${needles.size} needles, ${RU.requests.length} requests`;
});

// ================================================================================================ R — the reset contract
console.log("\nR — the reset contract");
await check("R1 arm, resetRingsCaches, read back EMPTY: the document, the hydrate's copy, the inbox keys, the received records, the reveal map, the publish status, the tick log", async () => {
  await on(W.m1, () => {
    globalThis.__layersHydratedNs = { rings: {} };
  });
  // LP-3: the address m1 handed out in F1 is still a claim in memory (its upkeep is due minutes to hours later), and the
  // upkeep has its moment drawn — both are this root's and must go with the reset too
  const armed = await on(W.m1, () => ({ doc: R.model.ringsDocLoaded(), recv: R.received.receivedCounts(), ticks: R.tick.ringsTickLog().length, inbox: globalThis.__layersRingInbox?.size ?? 0, claims: Object.keys(R.model.pendingClaims()).length, upkeep: R.model.upkeepDueAt() }));
  assert(armed.doc && armed.recv.records > 0 && armed.recv.reveals > 0 && armed.ticks > 0 && armed.inbox > 0 && armed.claims > 0 && armed.upkeep !== null, "not armed: " + JSON.stringify(armed));
  await on(W.m1, () => R.tick.resetRingsCaches());
  const after = await on(W.m1, () => ({ doc: R.model.ringsDocLoaded(), recv: R.received.receivedCounts(), ticks: R.tick.ringsTickLog().length, inbox: globalThis.__layersRingInbox?.size ?? 0, hyd: R.model ? globalThis.__layersHydratedNs?.rings : "x", pub: R.publisher.publishStatus().lastAttemptAt, claims: Object.keys(R.model.pendingClaims()).length, upkeep: R.model.upkeepDueAt(), fresh: R.model.ringsDocAgeMs() }));
  assert(!after.doc && after.recv.records === 0 && after.recv.reveals === 0 && !after.recv.fetched && after.ticks === 0 && after.inbox === 0 && after.hyd === undefined && after.pub === null && after.claims === 0 && after.upkeep === null && after.fresh === null, "after the reset: " + JSON.stringify(after));
  let threw = false;
  await on(W.m1, async () => {
    try {
      await R.note.noteForPost("fixture", "p_any", hex(32));
    } catch {
      threw = true;
    }
  });
  assert(threw, "after a plain reset the composer path did not refuse (cold)");
  await on(W.m1, () => R.tick.resetRingsCaches({ knownEmpty: true }));
  const n = await on(W.m1, () => R.note.noteForPost("fixture", "p_any", hex(32)));
  assert(n.length === 512, "after a seed reset (knownEmpty) the composer path does not answer at once");
});

// ================================================================================================ S — the seams, read from source
console.log("\nS — the seams (structural, from the source)");
const src = (f) => readFileSync(path.join(ROOT, f), "utf8");
await check("S1 the half-and-half avatar is ROOT/linked LEFT and the persona RIGHT on every merge in CastCard (the ring's anon merge, a ring's fid merge, the existing persona merge); the ring halves are inline Faces, never a URL; the testid cast-split-avatar is kept", () => {
  const cc = src("components/CastCard.tsx");
  const sa = src("components/rings/SplitAvatar.tsx");
  assert(/data-testid=\{testid\}/.test(sa) && /testid = "cast-split-avatar"/.test(sa), "SplitAvatar does not keep cast-split-avatar");
  assert(/clipPath: "polygon\(0 0, 50% 0, 50% 100%, 0 100%\)" \}\}>\s*\{left\}/.test(sa) && /clipPath: "polygon\(50% 0, 100% 0, 100% 100%, 50% 100%\)" \}\}>\s*\{right\}/.test(sa), "SplitAvatar's left/right halves are not where their names say");
  const ring = cc.slice(cc.indexOf("cast.anon && cast.ringShared ? ("), cc.indexOf(") : cast.author.merged && cast.author.linked ? ("));
  assert(/left=\{<Face thumb=\{cast\.ringShared\.root\.thumb\}/.test(ring) && /right=\{<Face thumb=\{cast\.ringShared\.persona\.thumb\}/.test(ring), "the ring's anon merge is not root-left / persona-right with inline faces");
  assert(!/MediaImg/.test(ring), "the ring's anon merge loads an image");
  const merge = cc.slice(cc.indexOf(") : cast.author.merged && cast.author.linked ? ("), cc.indexOf("<MediaImg\n                src={cast.author.pfpUrl}"));
  assert(/left=\{\s*cast\.author\.linked\.tier === "ring" \? \(\s*<Face thumb=\{cast\.author\.linked\.thumb/.test(merge), "a ring's fid merge: the left half is not the root's inline face");
  assert(/<MediaImg src=\{cast\.author\.linked\.pfpUrl\}/.test(merge.slice(merge.indexOf("left="), merge.indexOf("right="))), "the persona merge: the LINKED identity is not on the left");
  assert(/right=\{<MediaImg src=\{cast\.author\.pfpUrl\}/.test(merge), "the persona merge: the persona is not on the right");
  assert(/data-testid="cast-ring-shared"/.test(cc) && /data-persona=\{cast\.ringShared\.persona\.handle\}/.test(cc), "no cast-ring-shared line");
});
await check("S2 the reset contract is wired: reloadIdentity resets every rings cache BEFORE bootIdentity re-hydrates; resetSeed resets them AFTER the wipe (knownEmpty) and empties the drop", () => {
  const boot = src("lib/device/boot.ts");
  const reload = boot.slice(boot.indexOf("export async function reloadIdentity"));
  const at = reload.indexOf("resetRingsCaches()");
  assert(at > 0 && at < reload.indexOf("return bootIdentity()"), "reloadIdentity does not reset the rings caches before bootIdentity");
  const devr = src("app/api/dev/route.ts");
  const reset = devr.slice(devr.indexOf('body.action === "resetSeed"'));
  const wipe = reset.indexOf("await resetState()");
  const ring = reset.indexOf("resetRingsCaches({ knownEmpty: true })");
  assert(wipe > 0 && ring > wipe, "resetSeed does not reset the rings caches after the wipe");
  assert(reset.indexOf('"/rings/dev/reset"') > wipe, "resetSeed does not empty the drop");
  const persist = src("lib/adapters/mock/persist.ts");
  // PERSONA LAUNCH GO-LIVE: the union may grow past "rings" (a parked track's namespace once followed it), so the member is
  // looked for inside the ExtraNamespace type itself rather than as its last line
  const extra = persist.slice(persist.indexOf("export type ExtraNamespace"), persist.indexOf(";", persist.indexOf("export type ExtraNamespace")) + 1);
  assert(extra.length > 30 && /\| "rings"(\s|;)/.test(extra), "ExtraNamespace lacks rings");
});
await check("S3 the tick: lib/zk/prefetch.ts runs the rings part for EVERY tick, outside the zk part's try (a failed zk prefetch still reads the drop), and never lets it throw", () => {
  const pf = src("lib/zk/prefetch.ts");
  const run = pf.slice(pf.indexOf("async function runTick"), pf.indexOf("export function prefetchTick"));
  const zkCatch = run.indexOf("} catch (e) {\n    tick = { at: Date.now(), mode, ok: false");
  const rings = run.indexOf('(await import("@/lib/rings/tick")).ringsTick(mode)');
  assert(zkCatch > 0 && rings > zkCatch, "the rings part is inside the zk part (a failed zk prefetch would skip the drop read)");
  assert(/try \{\s*const r = await \(await import\("@\/lib\/rings\/tick"\)\)\.ringsTick\(mode\);/.test(run), "the rings part is not wrapped in its own try");
});

function uxSeams(paneSrc, routeSrc, deviceSrc, cardSrc) {
  // UX-R3: your own address says it lets its holder WRITE to you; the link's sentence stays inside the link box only
  assert(/ADDRESS_PRIVATELY = "Send it over Signal or in person: whoever holds it can write notes to you\."/.test(paneSrc), "UX-R3: no write-notes sentence for an address");
  const create = paneSrc.slice(paneSrc.indexOf('data-testid="rings-address-create"'), paneSrc.indexOf('data-testid="rings-address-create"') + 900);
  assert(/ADDRESS_PRIVATELY/.test(create) && !/\{SEND_PRIVATELY\}/.test(create), "UX-R3: the address sentence beside 'Make a private address' is not the write-notes one");
  const linkBox = paneSrc.slice(paneSrc.indexOf('data-testid="member-link-box"'), paneSrc.indexOf('data-testid="member-link-box"') + 600);
  assert(/\{SEND_PRIVATELY\}/.test(linkBox) && (paneSrc.match(/\{SEND_PRIVATELY\}/g) ?? []).length === 1, "UX-R3: the read-what-you-share sentence is used outside the link box");
  // UX-R2: on the owner service no link is offered and no delivery promised; the route refuses makeLink there
  assert(/\{!s\.ownerService && \(\s*<button\s+type="button"\s+data-testid="member-make-link"/.test(paneSrc), "UX-R2: 'Make a link instead' is not hidden on the owner service");
  assert(/s\.ownerService \? "Added\. " \+ s\.ownerServiceLine/.test(paneSrc), "UX-R2: the Add note still promises delivery on the owner service");
  assert(/s\.ownerService \? s\.ownerServiceLine : ADDRESS_PRIVATELY/.test(paneSrc), "UX-R2: the address text on the owner service does not say where rings reach");
  const mk = routeSrc.slice(routeSrc.indexOf('case "makeLink":'), routeSrc.indexOf('case "setDepth":'));
  assert(/if \(await onOwnerService\(\)\) return NextResponse\.json\(\{ error: [^}]+\}, \{ status: 409 \}\);\s*return NextResponse\.json\(\{ ok: true, \.\.\.\(await out\.makeLink/.test(mk), "UX-R2: the route makes a link on the owner service");
  assert(/ownerService: await onOwnerService\(\)/.test(routeSrc) && /isOwnerService\(\)/.test(routeSrc), "UX-R2: the pane is not told it runs on the owner service");
  // UX-R4: Forget asks first (pane and device page) and Remove asks first
  const forget = paneSrc.slice(paneSrc.indexOf('data-testid="rings-address-forget"'), paneSrc.indexOf('data-testid="rings-address-forget"') + 500);
  assert(/if \(!window\.confirm\(FORGET_CONFIRM\)\) return;\s*void run\("forget"/.test(forget), "UX-R4: 'Forget it' acts on one tap in the pane");
  const remove = paneSrc.slice(paneSrc.indexOf('data-testid="member-revoke"'), paneSrc.indexOf('data-testid="member-revoke"') + 500);
  assert(/if \(!window\.confirm\([\s\S]{1,300}?\)\) return;\s*void run\("revoke"/.test(remove), "UX-R4: 'Remove' acts on one tap");
  const dforget = deviceSrc.slice(deviceSrc.indexOf('data-testid="device-rings-address-forget"'), deviceSrc.indexOf('data-testid="device-rings-address-forget"') + 500);
  assert(/if \(!window\.confirm\([\s\S]{1,300}?\)\) return;\s*void act\(\(\) => api\(\)!\.forgetAddress/.test(dforget), "UX-R4: 'Forget it' acts on one tap on the device page");
  assert(/data-testid="rings-address-restore"/.test(paneSrc) && /data-testid="device-rings-address-restore"/.test(deviceSrc), "UX-R4: no 'Use it again'");
  // UX-L9: "anyone can check it" ONLY for a key read from the real network; every other case says test data
  const fn = cardSrc.slice(cardSrc.indexOf("export function chainCheckWords"), cardSrc.indexOf("export function chainCheckWords") + 700);
  assert(/chainSimulated === false\s*\?\s*"anyone can check it against the account's registered key"\s*:\s*"[^"]*\(test data: simulated chain\)"/.test(fn), "UX-L9: the simulated chain is not marked test data");
  assert((cardSrc.match(/anyone can check it/gi) ?? []).length === 1, "UX-L9: 'anyone can check it' appears outside chainCheckWords");
  assert((cardSrc.match(/chainCheckWords\(cast\.attributedTo\.chainSimulated/g) ?? []).length === 2, "UX-L9: both titles do not go through chainCheckWords");
}
await check("S4 the UX seams: UX-R3 the address says its holder can WRITE to you (the link's sentence only in the link box); UX-R2 the owner service hides 'Make a link', promises no delivery and the route refuses a link there; UX-R4 Forget and Remove ask first, 'Use it again' exists; UX-L9 'anyone can check it' only off the simulated chain", () =>
  uxSeams(src("components/settings/RingsPane.tsx"), src("app/api/rings/route.ts"), src("components/device/DeviceApp.tsx"), src("components/CastCard.tsx"))
);

/** PERSONA LAUNCH wave 3 (final verify): the unowned review findings fixed in the pane and the /d card */
function uxWave3Seams(paneSrc, dropSrc) {
  // UXH-10: the Delete handler reads the route's deleteError and the note says "were deleted" only without one
  const del = paneSrc.slice(paneSrc.indexOf('data-testid="ring-delete"'), paneSrc.indexOf('data-testid="ring-delete"') + 700);
  assert(/if \(!window\.confirm\(deleteRingConfirm\(r\.label\)\)\) return;\s*void run\("delete", async \(\) => \{\s*const j = await post\(\{ action: "deleteRing", ringId: r\.id \}\);\s*setNote\(deleteRingNote\(typeof j\.deleteError === "string" && j\.deleteError \? j\.deleteError : null, s\.publish\.leaseHours\)\);/.test(del), "UXH-10: 'Delete ring' ignores the deletion's result");
  const note = paneSrc.slice(paneSrc.indexOf("export const deleteRingNote"), paneSrc.indexOf("export const deleteRingNote") + 600);
  assert(/deleteError\s*\?\s*\x60Deleted\.[^\x60]*couldn't be deleted yet[^\x60]*\x60\s*:\s*"Deleted\.[^"]*were deleted\."/.test(note), "UXH-10: the note says the notes were deleted whatever happened");
  assert(!/their notes are deleted now/.test(paneSrc), "UXH-10: the old 'deleted now' promise is still in the pane");
  // L6: both confirms say when the change reaches the root's other devices
  for (const fn of ["export const revokeConfirm", "export const deleteRingConfirm"]) {
    const body = paneSrc.slice(paneSrc.indexOf(fn), paneSrc.indexOf(fn) + 500);
    assert(paneSrc.includes(fn) && /Your other devices stop using the old key at their next check, within about 25 minutes\./.test(body), "L6: " + fn + " does not say when the root's other devices stop");
  }
  // UXH-15: a Copy button inside the shown-once link box, through the clipboard, with a plain line when it is refused
  const box = paneSrc.slice(paneSrc.indexOf('data-testid="member-link-box"'), paneSrc.indexOf('data-testid="member-link-box"') + 2000);
  assert(/data-testid="member-link-copy"/.test(box) && /navigator\.clipboard\.writeText\(url\)/.test(box) && /catch \{\s*setNote\("This browser didn't allow copying\./.test(box), "UXH-15: the shown-once link has no Copy button (or a refused copy is silent)");
  // UXH-13: the /d card no longer says "in Totem you'd also see" (a link-friend has no way in), and says the link can't
  const sub = dropSrc.slice(dropSrc.indexOf('data-testid="drop-card-subject"'), dropSrc.indexOf('data-testid="drop-card-subject"') + 1400);
  assert(!/you&rsquo;d also see|you'd also see/.test(dropSrc), "UXH-13: the /d card still promises 'in Totem you'd also see'");
  assert(/sub\.depth === "posts" \? <span className="text-x-sec"> — [^<]*not through this link<\/span>/.test(sub), "UXH-13: the deeper share is not said to be out of this link's reach");
}
await check("S5 wave 3 (final verify): UXH-10 Delete ring says 'were deleted' only when the deletion landed; L6 Remove and Delete say when the other devices stop; UXH-15 the shown-once link has a Copy button that speaks when refused; UXH-13 the /d card promises nothing the link cannot do", () =>
  uxWave3Seams(src("components/settings/RingsPane.tsx"), src("components/rings/DropCard.tsx"))
);

// ================================================================================================ the mutations
if (RUN_MUTATIONS) {
  console.log("\nMUTATIONS — a broken copy of each guard must turn its check red");
  await mutation("a SHORT note (255 bytes) → N1 size check", async () => {
    const M = await bundle({ "lib/rings/note.ts": [["export const NOTE_PT_BYTES = NOTE_BYTES - NOTE_NONCE_BYTES - 16;", "export const NOTE_PT_BYTES = NOTE_BYTES - NOTE_NONCE_BYTES - 17;"], ["const out = new Uint8Array(NOTE_BYTES);", "const out = new Uint8Array(NOTE_BYTES - 1);"]] });
    await noteSizeCheck(M);
  });
  await mutation("a note WITHOUT the cast-hash AAD → N2", async () => {
    const M = await bundle({ "lib/rings/note.ts": [["te.encode(NOTE_AAD_PREFIX + castHash)", "te.encode(NOTE_AAD_PREFIX)"]] });
    await noteAadCheck(M);
  });
  /** a fresh world with one ring and two members, published and ticked, under a bundle Mx */
  async function miniWorld(Mx) {
    V.db.exec("DELETE FROM ring_drop");
    const Wm = world();
    const rid = (await on(Wm.owner, () => Mx.outbound.createRing("Inner"))).id;
    const a1 = await on(Wm.m1, () => Mx.inbox.createAddress(null));
    const a2 = await on(Wm.m2, () => Mx.inbox.createAddress(null));
    await on(Wm.n1, () => Mx.inbox.createAddress(null));
    const m1 = (await on(Wm.owner, () => Mx.outbound.addMember(rid, a1.address))).memberId;
    const m2 = (await on(Wm.owner, () => Mx.outbound.addMember(rid, a2.address))).memberId;
    await on(Wm.owner, () => Mx.outbound.setDepth(rid, Wm.A.id, "posts"));
    const p = await anonPost(Mx, Wm.owner, Wm.A, "mini " + hex(3));
    await on(Wm.owner, () => Mx.publisher.publishOnce({ force: true }));
    for (const d of [Wm.m1, Wm.m2]) await tickOn(Mx, d);
    return { Wm, rid, m1, m2, p };
  }
  await mutation("FAILED read treated as FULL when the count does not match → F6", async () => {
    const M = await bundle({ "lib/rings/fetch.ts": [["if (!Number.isSafeInteger(j.count) || j.rows.length !== j.count)", "if (false)"]] });
    const { Wm, p } = await miniWorld(M);
    await fullFailedCheck(M, Wm, p.castHash);
  });
  await mutation("no monotonic seq (any generation replaces the record) → F7", async () => {
    const M = await bundle({ "lib/rings/received.ts": [["if (!existing || stmt.seq > existing.seq) {", "if (true) {"]] });
    const { Wm } = await miniWorld(M);
    await seqCheck(M, Wm);
  });
  await mutation("revoke WITHOUT rotating the key → F10", async () => {
    // PERSONA LAUNCH GO-LIVE (UXH-9): the revoke now hides the record; the anchor is the same rotation, after the hide
    const M = await bundle({ "lib/rings/outbound.ts": [["    m.since = {};\n    for (const [pid, depth] of Object.entries(r.depths)) if (depth === \"posts\") rotate(d, pid);", "    m.since = {};"]] });
    const { Wm, rid, m2, p } = await miniWorld(M);
    posts.alice = p; // revokeCheck's positive control opens the mini world's own pre-revoke post
    await revokeCheck(M, Wm, rid, m2);
  });
  await mutation("a member admitted WITHOUT a rotation (its keys start at the current generation) → F11", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["if (depth === \"posts\") m.since[pid] = advance(d, pid);", "if (depth === \"posts\") m.since[pid] = personaKeys(d, pid).gen;"]] });
    const { Wm, rid } = await miniWorld(M);
    posts.alice = (await anonPost(M, Wm.owner, Wm.A, "before n1 " + hex(3)));
    posts.afterRevoke = posts.alice;
    await sinceCheck(M, Wm, rid);
  });
  await mutation("no compartment check in the render seam → F14", async () => {
    const M = await bundle({ "lib/rings/merge.ts": [["  if (!doc || doc.loaded !== true) return true;\n  return doc.compartment === true;", "  return false;"]] });
    const { Wm, p } = await miniWorld(M);
    await compartmentCheck(M, Wm, p.castHash);
  });
  /** a patched copy of the validator in its own directory (require() caches a server.js by path), started in process */
  async function patchedValidator(tag, anchor, replacement) {
    const base = path.join(VCOPY_ROOT, tag);
    const dir = path.join(base, "validator");
    cpSync(path.join(ROOT, "validator"), dir, { recursive: true, filter: (src) => !/layers\.db|deaths\.log|x-index|[\\/]test([\\/]|$)/.test(src) });
    // validator/zk.js reads the ceremony record one directory up
    mkdirSync(path.join(base, "research"), { recursive: true });
    cpSync(path.join(ROOT, "research", "zk-ceremony-verification.json"), path.join(base, "research", "zk-ceremony-verification.json"));
    const f = path.join(dir, "ringdrop.js");
    const text = readFileSync(f, "utf8");
    if (!text.includes(anchor)) throw new Error("patch anchor not found in validator/ringdrop.js");
    writeFileSync(f, text.replace(anchor, replacement));
    return startValidator(path.join(dir, "server.js"));
  }
  await mutation("the validator WITHOUT its multiple-of-4 rule → V1", async () => {
    const VM = await patchedValidator("mod4", "if (rows.length % 4 !== 0) return refuse(", "if (false) return refuse(");
    try {
      await validatorRules(VM.base);
    } finally {
      VM.server.close();
    }
  });
  await mutation("the validator WITHOUT its per-device occupancy rule (W2-RINGS-DROP-FILL-DOS) → V3", async () => {
    const VM = await patchedValidator("occupancy", "if (liveOf(liveByDevice, deviceId, nowH) + net > maxLivePerDevice()) {", "if (false) {");
    try {
      await occupancyRule(VM.base);
    } finally {
      VM.server.close();
    }
  });
  await mutation("LP-2: the tick's re-read never adopts another device's newer copy → W1", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  const adopted = adoptIfNewer(got);\n  s.freshAt = Date.now();", "  const adopted = s.doc ? false : adoptIfNewer(got);\n  s.freshAt = Date.now();"]] });
    await twoDevicesCheck(M);
  });
  await mutation("LP-2: the seal does not re-check what the validator holds → W2", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  if (newerThan(stored, base)) {\n    adoptIfNewer(stored);", "  if (false) {\n    adoptIfNewer(stored);"]] });
    await raceCheck(M);
  });
  await mutation("LP-2: the composer seals a real note from a document of any age → W3", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  if (age === null || age > RINGS_NOTE_MAX_AGE_MS) throw new RingsStale(age);", "  void age;"]] });
    await staleCheck(M);
  });
  await mutation("LP-3: making an address writes at the click → W4", async () => {
    const M = await bundle({ "lib/rings/inbox.ts": [["  addPendingClaim(addrId, clean, claimedAt);\n  scheduleUpkeep(claimedAt);", "  addPendingClaim(addrId, clean, claimedAt);\n  await mutateRingsDoc(() => undefined);\n  scheduleUpkeep(claimedAt);"]] });
    await claimCheck(M);
  });
  await mutation("KEEP3: every add draws a fresh random chain (the first cut) → W5", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  if (k.gen + 1 - cur.start >= NOTE_SEGMENT_MAX_GENS) return rotate(doc, personaId, now);", "  return rotate(doc, personaId, now);"]] });
    await historyCheck(M);
  });
  await mutation("LP-5: a generation number sealed beside each key → W5", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["    out.push({ keyHex: chainKeyAt(s.headHex, from - s.start), n });", "    out.push({ keyHex: chainKeyAt(s.headHex, from - s.start), n, gen: from } as RingNoteKey);"]] });
    await historyCheck(M);
  });
  await mutation("ONE-RING: one oversize ring aborts the whole publish (the first cut) → W6", async () => {
    const M = await bundle({ "lib/rings/publisher.ts": [["            if (e instanceof RingStatementTooLarge) {\n              tooLarge = e;\n              break;\n            }", "            if (e instanceof RingStatementTooLarge) throw new Error(\"the ring shares too much for one note: \" + e.message);"]] });
    await oneRingCheck(M);
  });
  await mutation("ONE-RING: no up-front size check → W6", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["  try {\n    encodeStatement(s);\n  } catch (e) {", "  try {\n    void encodeStatement;\n  } catch (e) {"]] });
    await oneRingCheck(M);
  });
  await mutation("UX-R1: members are sent the ring's own name → W7", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["root ? root.displayName ?? root.fname : NEUTRAL_SHARED_BY);", "root ? root.displayName ?? root.fname : r.label);"]] });
    await neutralLabelCheck(M);
  });
  await mutation("a half-landed publish left on the drop (no withdrawal) → W9", async () => {
    const M = await bundle({ "lib/rings/publisher.ts": [["if (landed.length > 0 && (await deleteFromDrop(landed.map((x) => x.tokenHex))) === null) {", "if (false) {"]] });
    await partialCheck(M);
  });
  await mutation("UX-R4: 'Forget it' deletes the address → W8", async () => {
    const M = await bundle({ "lib/rings/inbox.ts": [["    (e as InboxEntry).forgottenAt = Date.now();", "    delete d.inbox[addrId];"]] });
    await forgetCheck(M);
  });
  // PERSONA LAUNCH GO-LIVE (UXH-9): one broken copy per hide-never-delete guard
  const REVOKE_ROTATE = "    for (const [pid, depth] of Object.entries(r.depths)) if (depth === \"posts\") rotate(d, pid);";
  await mutation("UXH-9: Remove DELETES the record again (the first cut) → H1", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["    m.hiddenAt = Date.now();\n    m.since = {};\n" + REVOKE_ROTATE, "    delete r.members[memberId];\n" + REVOKE_ROTATE]] });
    await hideRevokeCheck(M);
  });
  await mutation("UXH-9: Remove keeps the person's key bookkeeping (since) → H1", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["    m.since = {};\n" + REVOKE_ROTATE, REVOKE_ROTATE]] });
    await hideRevokeCheck(M);
  });
  await mutation("UXH-9: the publisher seals removed people again → H1", async () => {
    const M = await bundle({ "lib/rings/publisher.ts": [["for (const m of visibleMembers(r)) {", "for (const m of Object.values(r.members)) {"]] });
    await hideRevokeCheck(M);
  });
  await mutation("UXH-9: keysForMember without its hidden guard → H2", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  if (isHidden(ring) || isHidden(member)) return [];", "  void isHidden;"]] });
    await hiddenKeyCheck(M);
  });
  await mutation("UXH-9: the publisher seals every ring and every person (the first cut) → H3", async () => {
    const M = await bundle({ "lib/rings/publisher.ts": [["for (const r of visibleRings(d)) {", "for (const r of Object.values(d.rings)) {"], ["for (const m of visibleMembers(r)) {", "for (const m of Object.values(r.members)) {"]] });
    await hiddenRingCheck(M);
  });
  await mutation("UXH-9: a deleted ring counts toward 16 → H3", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["    const inUse = visibleRings(d);\n    if (inUse.length >= MAX_RINGS) throw new Error(`you already have ${MAX_RINGS} rings — that's", "    const inUse = Object.values(d.rings);\n    if (inUse.length >= MAX_RINGS) throw new Error(`you already have ${MAX_RINGS} rings — that's"]] });
    await hiddenRingCheck(M);
  });
  await mutation("UXH-9: a deleted ring is still 'seen' (the composer makes a real note for it) → H3", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  return visibleRings(doc).some((r) => r.depths[personaId] === \"posts\");", "  return Object.values(doc.rings).some((r) => r.depths[personaId] === \"posts\");"]] });
    await hiddenRingCheck(M);
  });
  await mutation("UXH-9: the composer line names a deleted ring → H3", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  return visibleRings(doc)\n    .filter((r) => r.depths[personaId] === \"posts\" && visibleMembers(r).length > 0)", "  return Object.values(doc.rings)\n    .filter((r) => r.depths[personaId] === \"posts\" && Object.keys(r.members).length > 0)"]] });
    await hiddenRingCheck(M);
  });
  const NO_JOIN = { "lib/rings/outbound.ts": [["    const gen = advance(d, pid);\n    for (const m of people) m.since[pid] = gen;", "    const gen = personaKeys(d, pid).gen;\n    for (const m of people) m.since[pid] = gen;"]] };
  await mutation("UXH-9: a restored person re-admitted at the CURRENT generation (no join: the removed window reopens) → H4", async () => {
    await restoreMemberCheck(await bundle(NO_JOIN));
  });
  await mutation("UXH-9: a restored ring re-admitted at the CURRENT generation (no join: the deleted window reopens) → H5", async () => {
    await restoreRingCheck(await bundle(NO_JOIN));
  });
  await mutation("UXH-9: the parser reads an unreadable 'removed' mark as 'in use' → H6", async () => {
    const M = await bundle({ "lib/rings/model.ts": [["  throw new Error(`vault: \"${RINGS_NS}\" holds ${what} whose \"removed\" mark", "  return null;\n  throw new Error(`vault: \"${RINGS_NS}\" holds ${what} whose \"removed\" mark"]] });
    await parserCheck(M);
  });
  await mutation("UXH-9: a NEW ring past the record bound → H7", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["if (Object.keys(d.rings).length >= MAX_RING_RECORDS) throw new Error(RING_RECORDS_FULL);", "if (false) throw new Error(RING_RECORDS_FULL);"]] });
    await boundsCheck(M);
  });
  await mutation("UXH-9: a NEW person past the record bound → H7", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["  if (Object.keys(r.members).length >= MAX_MEMBER_RECORDS_PER_RING) throw new Error(memberRecordsFull(r.label));", "  void memberRecordsFull;"]] });
    await boundsCheck(M);
  });
  await mutation("UXH-9: a skipped ring keeps every row under its prefix, a removed person's too (the first cut) → H9", async () => {
    const M = await bundle({ "lib/rings/publisher.ts": [["const keptForSkipped = (x: LiveRow) => x.owner !== null && skippedOwners.has(x.owner);", "const keptForSkipped = (x: LiveRow) => x.owner !== null && skipped.some((s) => (x.owner as string).startsWith(s.id + \"|\"));"]] });
    await skippedRingRemovedRowCheck(M);
  });
  await mutation("UXH-9: a ring restored past 16 rings in use → H7", async () => {
    const M = await bundle({ "lib/rings/outbound.ts": [["if (inUse.length >= MAX_RINGS) throw new Error(`you already have ${MAX_RINGS} rings in use", "if (false) throw new Error(`you already have ${MAX_RINGS} rings in use"]] });
    await boundsCheck(M);
  });
  {
    const paneH = readFileSync(path.join(ROOT, "components/settings/RingsPane.tsx"), "utf8");
    const routeH = readFileSync(path.join(ROOT, "app/api/rings/route.ts"), "utf8");
    const swapH = (text, from, to) => {
      if (!text.includes(from)) throw new Error("patch anchor not found: " + from.slice(0, 80));
      return text.split(from).join(to);
    };
    await mutation("UXH-9: the restore sentence gone from beside the Restore buttons → H8", async () => hideSeams(swapH(paneH, "{RESTORE_MEMBER_LINE}\n            </p>", "{null}\n            </p>"), routeH));
    await mutation("UXH-9: the route loses restoreMember → H8", async () => hideSeams(paneH, swapH(routeH, 'case "restoreMember":', 'case "restoreMemberGone":')));
    await mutation("UXH-9: Remove no longer says where the person goes → H8", async () => hideSeams(swapH(paneH, "within about 25 minutes. ${REMOVED_KEPT}`", "within about 25 minutes.`"), routeH));
  }
  {
    const pane = src("components/settings/RingsPane.tsx");
    const route = src("app/api/rings/route.ts");
    const dev = src("components/device/DeviceApp.tsx");
    const card = src("components/CastCard.tsx");
    const swap = (text, from, to) => {
      if (!text.includes(from)) throw new Error("patch anchor not found: " + from.slice(0, 80));
      return text.split(from).join(to);
    };
    await mutation("UX-R3: the read-what-you-share sentence back beside your own address → S4", async () => uxSeams(swap(pane, "{s.ownerService ? s.ownerServiceLine : ADDRESS_PRIVATELY}", "{s.ownerService ? s.ownerServiceLine : SEND_PRIVATELY}"), route, dev, card));
    await mutation("UX-R2: the route makes a link on the owner service → S4", async () => uxSeams(pane, swap(route, "if (await onOwnerService()) return NextResponse.json({ error: ", "if (false) return NextResponse.json({ error: "), dev, card));
    await mutation("UX-R4: 'Forget it' on one tap again → S4", async () => uxSeams(swap(pane, "if (!window.confirm(FORGET_CONFIRM)) return;", ""), route, dev, card));
    await mutation("UX-R4: 'Remove' on one tap again → S4", async () => uxSeams(swap(pane, "if (!window.confirm(revokeConfirm(", "if (false && window.confirm(revokeConfirm("), route, dev, card));
    await mutation("UX-L9: 'anyone can check it' while the chain is simulated → S4", async () => uxSeams(pane, route, dev, swap(card, "chainSimulated === false\n      ? ", "true\n      ? ")));
    // PERSONA LAUNCH wave 3 (final verify): S5's guards
    const drop = src("components/rings/DropCard.tsx");
    const delNew = 'void run("delete", async () => {\n                    const j = await post({ action: "deleteRing", ringId: r.id });\n                    setNote(deleteRingNote(typeof j.deleteError === "string" && j.deleteError ? j.deleteError : null, s.publish.leaseHours));\n                  });';
    await mutation("UXH-10: Delete ring ignores its result again → S5", async () => uxWave3Seams(swap(pane, delNew, 'void run("delete", () => post({ action: "deleteRing", ringId: r.id }));'), drop));
    await mutation("UXH-10: the note says 'were deleted' over a failed deletion → S5", async () => uxWave3Seams(swap(pane, "Their notes couldn't be deleted yet (", "Their notes were deleted (we tried: "), drop));
    await mutation("L6: Remove no longer says when the other devices stop → S5", async () => uxWave3Seams(swap(pane, "what they already saw stays with them. Your other devices stop using the old key at their next check, within about 25 minutes.", "what they already saw stays with them."), drop));
    await mutation("UXH-15: the Copy button gone → S5", async () => uxWave3Seams(swap(pane, 'data-testid="member-link-copy"', 'data-testid="member-link-nocopy"'), drop));
    await mutation("UXH-13: the /d card promises the deeper share again → S5", async () => uxWave3Seams(pane, swap(drop, "which anonymous posts it wrote is shared too, but only in Totem with a private address, not through this link", "in Totem you&rsquo;d also see which anonymous posts it wrote")));
  }
}

V.server.close();
console.log(`\n${passed}/${passed + failed} rings unit checks passed${failed ? ` — FAILED: ${failures.join("; ")}` : ""}`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50).unref?.();
