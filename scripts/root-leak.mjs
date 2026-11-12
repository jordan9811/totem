// ROOT-LEAK TEST. Runs every iteration, not just Gate 0.
//
// Proves: no adapter response, page payload, cookie, or persisted record
// outside the keystore contains root material — and, since the crypto
// pass, KEY MATERIAL: persona signing seeds, the vault key, the
// device-auth seed, the device private key, and the recovery mnemonic.
//
// Needles are re-derived here with an independent noble import (the
// substrate.test.js deliberate-duplicate discipline): if the app's
// derivation drifts from this file, the needles miss and Gate 0's
// determinism check is what catches the drift — the two suites cover
// each other.
//
// Exit 1 = a leak (a real failure). Exit 2 = could not test.
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Identity } from "@semaphore-protocol/identity";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VALIDATOR = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;

let leaks = 0;
let checked = 0;
const findings = [];

function report(where, what, sample) {
  leaks++;
  findings.push({ where, what, sample });
  console.log(`  LEAK  ${where} — ${what}`);
  if (sample) console.log(`        ${String(sample).slice(0, 160)}`);
}

// ---- root + key material to hunt for ----
const needles = [];
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
const kdf = (seed, info) => hkdf(sha256, seed, new Uint8Array(0), te.encode("layers/v1/" + info), 32);
const keystorePath = path.join(process.cwd(), ".keystore", "root.json");
if (existsSync(keystorePath)) {
  try {
    const ks = JSON.parse(readFileSync(keystorePath, "utf8"));
    if (ks.rootSecretHex) {
      needles.push({ value: ks.rootSecretHex, label: "root secret" });
      // the derived handle, recomputed the same way keystore.ts does
      const { createHash } = await import("node:crypto");
      needles.push({
        value: createHash("sha256").update("root:").update(ks.rootSecretHex).digest("hex").slice(0, 24),
        label: "root handle",
      });
      // CRYPTO PASS: the derived-key needle set, independently re-derived
      const seed = new Uint8Array(Buffer.from(ks.rootSecretHex, "hex"));
      needles.push({ value: toHex(kdf(seed, "vault/1")), label: "vault key" });
      needles.push({ value: toHex(kdf(seed, "device-auth/1")), label: "device-auth seed" });
      for (const p of ks.personas ?? []) {
        needles.push({ value: toHex(kdf(seed, "persona-sign/" + p.nonce)), label: `persona sign seed (${p.id})` });
      }
      // the recovery mnemonic IS the seed in another encoding — hunted as
      // a joined phrase (a payload carrying even a fragment of it would
      // carry consecutive words; the full-phrase needle catches the
      // catastrophic case, Gate 4's own tests cover partial exposure)
      needles.push({ value: bip39.entropyToMnemonic(seed, wordlist), label: "recovery mnemonic" });
      // ZK PASS 1: zk secret material — the zk-identity master branch, the
      // Semaphore secret scalar (decimal AND hex: the nullifier preimage
      // half), and the identity's private-key export. Any of these outward
      // is the root's entire proving capability leaking, forever.
      const zkMaster = kdf(seed, "zk-identity/1");
      needles.push({ value: toHex(zkMaster), label: "zk master (HKDF zk-identity/1)" });
      const zkId = new Identity(zkMaster);
      needles.push({ value: zkId.secretScalar.toString(10), label: "zk secret scalar (dec)" });
      needles.push({ value: zkId.secretScalar.toString(16), label: "zk secret scalar (hex)" });
      needles.push({ value: zkId.export(), label: "zk private key export (base64)" });
    }
  } catch {
    /* unreadable keystore is not a leak */
  }
}
// the device's own private key (device.json is device-local material)
const devicePath = path.join(process.cwd(), ".keystore", "device.json");
if (existsSync(devicePath)) {
  try {
    const dev = JSON.parse(readFileSync(devicePath, "utf8"));
    if (dev.privHex) needles.push({ value: dev.privHex, label: "device private key" });
  } catch {
    /* unreadable device file is not a leak */
  }
}

/** Structural check: an outward payload must not carry a rootId key,
 * and — Tier A — must not carry relationship event-log material either.
 * The log is the user's private history; the ONLY routes allowed to return
 * it are the /api/eventlog family — /api/eventlog (the viewer's own log,
 * actor fixed server-side) and, since PROD-LIVE, /api/eventlog/history
 * (the profile's relationship-history tab from that same log). */
function scanStructure(where, text, { allowEventLog = false } = {}) {
  checked++;
  if (/"rootId"\s*:/.test(text)) {
    const m = text.match(/"rootId"\s*:\s*"?[^",}]*/);
    report(where, "carries a rootId key", m?.[0]);
  }
  for (const n of needles) {
    if (n.value && text.includes(n.value)) report(where, `contains ${n.label}`, n.value.slice(0, 24));
  }
  if (!allowEventLog) {
    // Event ids are minted with an ev_ prefix, and the schema's field names
    // are distinctive; either one in a public payload is the log escaping.
    if (/"ev_[0-9a-f]/.test(text)) {
      report(where, "carries a relationship event id", text.match(/"ev_[0-9a-f]{6,}/)?.[0]);
    }
    if (/"triggeringCastId"\s*:/.test(text) || /"edgeEvents"\s*:/.test(text)) {
      report(where, "carries event-log schema fields");
    }
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

async function get(url) {
  try {
    const res = await page.request.fetch(url);
    return { ok: res.ok(), status: res.status(), text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: e.message };
  }
}

console.log("\nRoot-leak test");

// PROD-LIVE: the algo preview route needs a real card, and a seeded card's id is minted from a fixture signature
// (lib/algo/seed.ts), so it is read off the shelf rather than hard-coded. No card = the route is skipped, said aloud.
let algoCardId = null;
{
  const r = await get(BASE + "/api/algo");
  try {
    algoCardId = JSON.parse(r.text)?.cards?.[0]?.id ?? null;
  } catch {
    algoCardId = null;
  }
  if (!algoCardId) console.log("  NOTE  no seeded algo card on GET /api/algo — /api/algo/view is not scanned this run");
}

// 1. every API response shape
const API_ROUTES = [
  "/api/personas",
  "/api/modes",
  "/api/rules",
  "/api/blocked",
  "/api/disclosure",
  "/api/disclosure/facets",
  "/api/feed2?surface=discovery",
  "/api/feed2?surface=following",
  "/api/feed-health",
  "/api/graph",
  "/api/graph/preview",
  "/api/earnings",
  "/api/channels",
  "/api/folders",
  "/api/rooms",
  "/api/market/intent",
  "/api/market/campaign",
  "/api/market/measurement",
  "/api/dev",
  "/api/tier?tier=5",
  "/api/follow",
  "/api/search?q=restaking",
  // Tier B surfaces: packs, crosspost, InfoFi, and curator issuance — the
  // annotation/draft payloads are outward data like any other
  "/api/packs",
  "/api/crosspost?text=leakprobe",
  "/api/market/infofi?surface=inbox",
  "/api/market/infofi?surface=ledger",
  "/api/curators",
  "/api/x/link",
  "/api/x/import",
  "/api/x/spend",
  "/api/x/migrate",
  "/api/personas/bindings",
  "/api/personas/act-as-options",
  "/api/modes",
  "/api/x/coldstore",
  "/api/graph/score",
  "/api/x/altlink",
  // FC pass: the write ledger + the attribution surface. Attribution
  // responses carry persona DISPLAY data only — a root or grant needle
  // here would mean the index is leaking linkage material outward.
  "/api/fc/write",
  "/api/fc/attribution?hashes=0xcr0011,0xcr0012",
  // ZK PASS 1: the zk status surface (commitment, epochs, tree sizes,
  // pins) — public material only; a zk needle here is a failed gate.
  "/api/zk?mode=fixture",
  // PROD-LIVE (D-CU-0-4): the page-view routes. On a public deployment the
  // browser device answers them for the page's islands; on the rig the pages
  // compute the same views (lib/views/*) into their RSC payloads. Seeded
  // subjects: the viewer's own profile (the one with the linked-identities
  // disclosure) and a seeded post — the same ones the attribution line and
  // the PAGES list below already use.
  "/api/profile?handle=yeak__",
  "/api/thread?hash=0xcr0011",
  "/api/notifications",
  "/api/history",
  "/api/home",
  "/api/folders/view",
  "/api/channels/view",
  "/api/rooms/view",
  ...(algoCardId ? [`/api/algo/view?id=${algoCardId}`] : []),
];

// ZK PASS 1: the validator's public zk endpoints are outward payloads too
// (they are what a relay or any third party can read).
const VALIDATOR_ZK_ROUTES = [
  "/zk/validator-key",
  "/zk/epoch?mode=fixture",
  "/zk/trees?mode=fixture",
  "/zk/history?mode=fixture&tree=valid",
  "/zk/members?mode=fixture&tree=valid",
];

let reachable = 0;
for (const route of API_ROUTES) {
  const r = await get(BASE + route);
  if (r.status === 0) continue;
  reachable++;
  scanStructure(`GET ${route}`, r.text);
}

// The sanctioned event-log surfaces: scanned for root material but the
// event-log allowance applies — they exist to return the viewer's OWN log.
// PROD-LIVE: /api/eventlog/history is the same family (the profile's
// relationship-history tab), asked about a seeded account the seeded viewer
// follows (gwei_whisperer — persona_acc_crypto_3 in seed/data/accounts.json).
for (const route of ["/api/eventlog", "/api/eventlog/history?target=persona_acc_crypto_3"]) {
  const r = await get(BASE + route);
  if (r.status !== 0) scanStructure(`GET ${route}`, r.text, { allowEventLog: true });
}

// CRYPTO PASS: POST responses were never scanned before — the recon
// found that gap. The probe here is deliberately side-effect-free
// (cryptoProbe mutates nothing); mutating POST responses are grepped
// inside their own suites, where the state they create is expected.
{
  try {
    const res = await page.request.fetch(BASE + "/api/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ action: "cryptoProbe" }),
    });
    scanStructure("POST /api/dev cryptoProbe", await res.text());
  } catch {
    /* unreachable dev route already covered by the reachable==0 gate */
  }
}

if (reachable === 0) {
  console.log("\nINFRA: no API route was reachable — cannot test");
  await browser.close();
  process.exit(2);
}

// 2. rendered page payloads (RSC payload included in the HTML)
const PAGES = ["/home", "/yeak__", "/settings/account", "/channels", "/folders", "/market"];
for (const p of PAGES) {
  const r = await get(BASE + p);
  if (r.status === 0) continue;
  scanStructure(`PAGE ${p}`, r.text);
}

// 3. cookies handed to the browser
await page.goto(BASE + "/home", { waitUntil: "domcontentloaded" }).catch(() => {});
const cookies = await ctx.cookies();
checked++;
for (const c of cookies) {
  for (const n of needles) {
    if (c.value.includes(n.value)) report(`COOKIE ${c.name}`, `contains ${n.label}`, c.value);
  }
  if (/^root_/.test(c.value)) {
    report(`COOKIE ${c.name}`, "carries a raw root id", c.value);
  }
}

// 3b. ZK PASS 1: the validator's public zk surface
for (const route of VALIDATOR_ZK_ROUTES) {
  const r = await get(VALIDATOR + route);
  if (r.status === 0) continue;
  scanStructure(`VALIDATOR GET ${route}`, r.text);
}

// 4. persisted records outside the keystore (validator adapter_state)
const st = await get(VALIDATOR + "/state");
if (st.status !== 0) {
  checked++;
  for (const n of needles) {
    if (st.text.includes(n.value)) report("VALIDATOR /state", `contains ${n.label}`, n.value.slice(0, 24));
  }
  // CRYPTO PASS Gate 2: vault plaintext must never sit at rest on the
  // untrusted server. The distinctive seeded private-post texts and the
  // vault canary are the needles — a hit means a vault namespace flushed
  // plaintext instead of ciphertext.
  const vaultPlaintext = [
    "clouded out again",
    "took the 8in out to the field",
    "honestly half the reason i keep this account separate",
    "layers-vault-canary",
    // BACKPACK PASS: backpack claims are vault data (graphClaims namespace).
    // Needles are connector labels/issuers that ACTUALLY flush to the
    // validator on import — NOT the seed self-claims ("Espresso",
    // "Amateur astronomy"), which live in a read-time overlay and are never
    // persisted to graphClaims, so they'd give a false-green. A hit here
    // means an imported backpack claim leaked plaintext. Tripwire: fires
    // only if such a claim was imported AND flushed unencrypted.
    "Controls a verifiable DID",
    "did:web:layers.example",
    "Verified degree: B.S. Computer Science",
    "Listens to jazz weekly",
    "Northgate Bank",
    "Corvid Health",
  ];
  for (const n of vaultPlaintext) {
    if (st.text.includes(n)) report("VALIDATOR /state", "contains VAULT PLAINTEXT", n);
  }
  // sessionHandles legitimately maps handle -> rootId server-side; it is not
  // an outward payload, so a rootId VALUE there is allowed. A rootId KEY in
  // any other namespace is not.
  try {
    const parsed = JSON.parse(st.text).state ?? {};
    for (const [ns, entries] of Object.entries(parsed)) {
      if (ns === "sessionHandles") continue;
      const asText = JSON.stringify(entries);
      if (/"rootId"\s*:/.test(asText)) report(`VALIDATOR /state[${ns}]`, "persisted record carries rootId");
    }
  } catch {
    /* non-JSON state is checked by the substring scan above */
  }
}

await browser.close();

// 5. PERSONA LAUNCH P3 (additive): A PERSONA THAT ONLY POSTS ANONYMOUSLY NEVER APPEARS IN THE VALIDATOR'S PLAINTEXT.
// An anon post is now made AS a persona (POST /api/anon {text, personaId}); the persona lives only in the device's
// sealed reveal record. So a persona minted FRESH for this section — forked from a seeded account with no account of its
// own (shared-fid mode, under the mock binding: no continuity proof names it) and never rendered as the acting persona
// (no tier proof names it) — that posts one anonymous post must not appear ANYWHERE the validator stores or logs it:
// no table row, no /state value or key, no line of its log. NON-VACUOUS: the anon row must exist first, the device's
// own status must say the post was made AS that persona, and the sealed queue must hold that persona in its record —
// read back cold through the dev readback, which also reports whether the id is visible in the stored bytes.
// It runs LAST (it mutates the rig: a fork, the zk binding, an anon post) and resets the seed after itself.
let anonSectionFailure = null;
{
  const { DatabaseSync } = await import("node:sqlite");
  const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
  const VLOG = process.env.LAYERS_VALIDATOR_LOG || (process.env.TEMP ? process.env.TEMP + "/layers-validator.log" : null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const retry = async (fn, attempts = 4) => {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fn();
        if (r.status >= 200 && r.status < 300) return r;
        last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
      } catch (e) {
        last = e;
      }
      await sleep(250 * (i + 1));
    }
    throw last;
  };
  const dev = (action, extra = {}) => call("POST", BASE + "/api/dev", { action, ...extra });
  const zk = (action, extra = {}) => call("POST", BASE + "/api/zk", { action, mode: "fixture", ...extra });
  const persona = (action, extra = {}) => call("POST", BASE + "/api/fc/persona", { action, ...extra });
  const seedList = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      if (o.handle && o.id) seedList.push(o);
      Object.values(o).forEach(walk);
    }
  })(JSON.parse(readFileSync("seed/data/accounts.json", "utf8")));
  const SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;
  const hitsFor = (id) => {
    const out = [];
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      try {
        db.exec("PRAGMA busy_timeout = 8000");
      } catch {
        /* a read-only handle may refuse the setting */
      }
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) if (JSON.stringify(row).includes(id)) out.push(name);
      }
    } finally {
      db.close();
    }
    return out;
  };
  let FRESH = null;
  try {
    console.log("\n5. PERSONA LAUNCH P3: a persona that only posts anonymously never appears in the validator's plaintext");
    if (!SOURCE) throw new Error("no seeded fork source (brothandbones)");
    if (!existsSync(DB_PATH)) throw new Error("INFRA: validator DB not found at " + DB_PATH);
    await retry(() => dev("resetSeed"));
    await retry(() => zk("resetZk"));
    await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
    try {
      const f = await retry(() => call("POST", BASE + "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: "rleak_anon_" + Date.now().toString(36).slice(-5) }));
      FRESH = f.json?.newPersona ?? null;
      if (!FRESH || f.json?.newFid) throw new Error("the fresh persona was not minted without an account: " + JSON.stringify(f.json).slice(0, 200));
    } finally {
      await retry(() => persona("setNetworkMode", { mode: null }));
    }
    const baseline = hitsFor(FRESH);
    await retry(() => zk("setRepImpl", { impl: "zk" }));
    await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
    await retry(() => zk("seedDecoys", { count: 60 }));
    await retry(() => zk("register"));
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const text = `root-leak anon ${Date.now().toString(36)} [layers-test fixture]`;
    const q = await call("POST", BASE + "/api/anon", { text, personaId: FRESH });
    if (q.status !== 202 || q.json?.personaId !== FRESH) throw new Error("the anon post as the fresh persona was not queued: " + q.status + " " + JSON.stringify(q.json).slice(0, 200));
    const castHash = q.json.castHash;
    let queued = null;
    for (let i = 0; i < 3 && !queued; i++) {
      await retry(() => zk("prefetchNow"));
      await sleep(400);
      const s = (await retry(() => call("GET", BASE + `/api/anon?castHash=${castHash}&envelope=1`))).json;
      if (s?.item?.status === "queued") queued = s;
      else if (s?.outcome?.lastStage === "epoch-edge") throw new Error("INFRA: the rig's epoch ends inside the jitter window — re-run after the boundary");
    }
    if (!queued) throw new Error("the post was never proved");
    if (queued.personaId !== FRESH) throw new Error("the device's own status does not say the post was made as the fresh persona: " + queued.personaId);
    if (JSON.stringify(queued.envelope ?? {}).includes(FRESH)) report("ANON ENVELOPE (the wire)", "names the persona the anon post was made as", FRESH);
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    const st = (await retry(() => call("GET", BASE + `/api/anon?castHash=${castHash}`))).json;
    if (st?.item?.outcome !== "accepted") throw new Error("the anon post was not accepted: " + JSON.stringify(st?.item));
    // NON-VACUOUS: the anon row exists, and the sealed queue (read back cold) holds this persona in its record
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    let row;
    try {
      row = db.prepare("SELECT * FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(castHash);
    } finally {
      db.close();
    }
    if (!row) throw new Error("the anon row is not in the validator's database — nothing to scan beside");
    const rb = (await retry(() => zk("anonQueueReadback", { personaIds: [FRESH] }))).json;
    if (!rb?.records?.some((r) => r.castHash === castHash && r.personaId === FRESH)) throw new Error("the sealed queue does not hold the post's persona: " + JSON.stringify(rb?.records).slice(0, 200));
    checked++;
    if ((rb.plaintextHits ?? []).length) report("VALIDATOR /state zkQueue", "the sealed queue's stored bytes show the anon poster's persona id", FRESH);
    // THE CLAIM: the persona appears nowhere the validator stores or logs (baseline hits are reported too — they would
    // mean the MINT leaked it, which the claim covers just the same)
    checked++;
    for (const t of hitsFor(FRESH)) report(`VALIDATOR DB ${t}${baseline.includes(t) ? " (already after the mint, before the anon post)" : ""}`, "a row names the persona that only posted anonymously", FRESH);
    const stState = await call("GET", VALIDATOR + "/state");
    checked++;
    if (JSON.stringify(stState.json ?? "").includes(FRESH)) report("VALIDATOR /state", "names the persona that only posted anonymously (a key or a value in the clear)", FRESH);
    if (VLOG && existsSync(VLOG)) {
      checked++;
      if (readFileSync(VLOG, "utf8").includes(FRESH)) report("VALIDATOR LOG", "names the persona that only posted anonymously", FRESH);
    } else console.log("  NOTE  validator log not found at " + VLOG + " — the database, /state and the wire are the evidence");
    console.log(`  anon section: persona ${FRESH.slice(0, 10)}… posted ${castHash.slice(0, 10)}… (row present, sealed record holds the persona); scanned every table, /state and the log`);
  } catch (e) {
    anonSectionFailure = (e && e.message) || String(e);
    console.log("  FAIL  anon section — " + anonSectionFailure);
  } finally {
    await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
    await retry(() => dev("resetSeed")).catch(() => {});
  }
}

// 6. PERSONA LAUNCH P4 (additive): RING MATERIAL NEVER LEAVES THE DEVICE. The rig's own device makes a private address,
// a ring holding its own address and a link-friend, shares a public persona at depth "posts", publishes and ticks; then
// every ring secret it holds — the inbox IKM and PSK of its address (re-derived from the seed by the keystore), the
// PSKs it seals to, its note keys, its drop tokens, the note keys it received — is hunted in every outward payload (the
// rings route and page, /state, the drop) and in every validator table; the ring's label and the address id are hunted
// on the validator's surfaces (the owner's own pane legitimately shows the label). NON-VACUOUS: the needles must exist
// (a published drop, received keys) before anything is scanned. It resets the seed after itself.
let ringsSectionFailure = null;
{
  const { DatabaseSync } = await import("node:sqlite");
  const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* a page */
    }
    return { status: r.status, json, text };
  };
  const retry = async (fn, attempts = 4) => {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fn();
        if (r.status >= 200 && r.status < 300) return r;
        last = new Error("status " + r.status + " " + String(r.text).slice(0, 200));
      } catch (e) {
        last = e;
      }
      await sleep(250 * (i + 1));
    }
    throw last;
  };
  const rings = (action, extra = {}) => call("POST", BASE + "/api/rings", { action, ...extra });
  try {
    console.log("\n6. PERSONA LAUNCH P4: ring material never leaves the device");
    await retry(() => call("POST", BASE + "/api/dev", { action: "resetSeed" }));
    // VERIFY (wave 2, harness fix): after resetSeed the rig's device holds NO admissible ring subject (the seed's
    // personas are not this device's public personas, and main has no connected account), so this section failed its
    // own premise on the first rig run. It mints one public persona the way accept-rings does (a fork in shared-fid
    // mode) and shares exactly that one.
    const seeds = [];
    (function walk(o) {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (o.handle && o.id) seeds.push(o);
        Object.values(o).forEach(walk);
      }
    })(JSON.parse(readFileSync("seed/data/accounts.json", "utf8")));
    const source = seeds.find((p) => p.handle === "brothandbones")?.id;
    if (!source) throw new Error("no seeded fork source (brothandbones)");
    const fcPersona = (action, extra = {}) => call("POST", BASE + "/api/fc/persona", { action, ...extra });
    let forked = null;
    await retry(() => fcPersona("setNetworkMode", { mode: "shared-fid" }));
    try {
      forked = (await retry(() => call("POST", BASE + "/api/identity/fork", { fromPersona: source, carry: [], newHandle: "rleak_ring_" + Date.now().toString(36).slice(-5) }))).json?.newPersona ?? null;
    } finally {
      await retry(() => fcPersona("setNetworkMode", { mode: null }));
    }
    if (!forked) throw new Error("the public persona to share was not minted");
    const pane = (await retry(() => call("GET", BASE + "/api/rings"))).json;
    const persona = pane?.admissible?.find((p) => p.personaId === forked);
    if (!persona) throw new Error("the forked persona is not an admissible ring subject: " + JSON.stringify(pane?.admissible).slice(0, 200));
    const label = "rleakring" + Date.now().toString(36);
    const addr = (await retry(() => rings("createAddress"))).json?.address?.address;
    if (!/^LR1\./.test(addr ?? "")) throw new Error("no address was made: " + addr);
    const ringId = (await retry(() => rings("createRing", { label }))).json?.id;
    await retry(() => rings("addMember", { ringId, address: addr }));
    await retry(() => rings("makeLink", { ringId }));
    await retry(() => rings("setDepth", { ringId, personaId: persona.personaId, depth: "posts" }));
    const pub = (await retry(() => rings("publishNow"))).json;
    if (!pub?.ok || !(pub.rows >= 4)) throw new Error("the publish did not land: " + JSON.stringify(pub));
    await retry(() => rings("tickNow", { mode: "fixture" }));
    const n = (await retry(() => rings("leakNeedles"))).json;
    const secrets = [...(n.pskHex ?? []), ...(n.noteKeys ?? []), ...(n.tokens ?? []), ...(n.inbox ?? []), ...(n.receivedKeys ?? [])].filter((x) => typeof x === "string" && x.length >= 32);
    if (secrets.length < 6 || !(n.receivedKeys ?? []).length || !(n.tokens ?? []).length) throw new Error("too few ring secrets to hunt (the premise did not hold): " + secrets.length);
    const onValidator = [...secrets, ...(n.addrIds ?? []), label];
    const scan = (where, text, list) => {
      checked++;
      for (const x of list) if (text.includes(x)) report(where, "contains ring material", x.slice(0, 24));
    };
    scan("API GET /api/rings", (await retry(() => call("GET", BASE + "/api/rings"))).text, secrets);
    scan("PAGE /settings/rings", (await call("GET", BASE + "/settings/rings")).text, secrets);
    scan("VALIDATOR /state", (await call("GET", VALIDATOR + "/state")).text, onValidator);
    const drop = await call("GET", VALIDATOR + "/rings/drop");
    if (!(drop.json?.count >= 4)) throw new Error("the drop holds no rows to scan beside");
    scan("VALIDATOR GET /rings/drop", drop.text, onValidator);
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
          const o = { ...row };
          if (name === "ring_drop") delete o.ct;
          if (name === "zk_anon_casts") delete o.note;
          checked++;
          const text = JSON.stringify(o);
          for (const x of onValidator) if (text.includes(x)) report(`VALIDATOR DB ${name}`, "a row carries ring material", x.slice(0, 24));
        }
      }
    } finally {
      db.close();
    }
    console.log(`  rings section: ${secrets.length} ring secrets and ${onValidator.length - secrets.length} validator-side needles hunted`);
  } catch (e) {
    ringsSectionFailure = (e && e.message) || String(e);
    console.log("  FAIL  rings section — " + ringsSectionFailure);
  } finally {
    await retry(() => call("POST", BASE + "/api/dev", { action: "resetSeed" })).catch(() => {});
  }
}

const sectionFailure = anonSectionFailure ?? ringsSectionFailure;
console.log(
  leaks === 0 && !sectionFailure
    ? `\nROOT-LEAK: clean (${checked} payloads scanned, ${needles.length} root-material needles, plus the anon-poster and ring sections)`
    : leaks
      ? `\nROOT-LEAK: ${leaks} LEAK(S) FOUND`
      : `\nROOT-LEAK: no leak found, but a section could not complete: ${sectionFailure}`
);
// a leak is 1; a section that could not establish its own premise is a failure too (1), unless it was the rig (2)
process.exit(leaks !== 0 ? 1 : sectionFailure ? (/INFRA:|ECONNREFUSED|fetch failed/.test(sectionFailure) ? 2 : 1) : 0);
