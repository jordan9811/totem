// ZK PASS 1 — GATE 0: foundation. FIXTURE-SAFE: never proves live, never
// posts, never spends; talks only to the local app + validator.
//
// DELIBERATE DUPLICATES (substrate.test.js discipline): this suite
// re-derives the zk identity from the keystore with its own HKDF + the
// stock Semaphore identity package, recomputes nullifiers with its own
// Poseidon, re-hashes history entries and re-verifies validator
// signatures with its own noble import, and mints fixture tags with its
// own copy of the toy scheme. If the app's derivation, canonical forms or
// formulas drift, the sign-here/verify-there checks fail — that is the
// point.
//
// SAFETY SET (3 consecutive fails halt the pass): ceremony/vkey pins,
// scope-collision, key/secret leak grep.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { ed25519 } from "@noble/curves/ed25519";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { poseidon2 } from "poseidon-lite";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";

// ---- deliberate duplicates ----
const DOMAIN = "layers/v1/";
const kdf = (seed, info) => hkdf(sha256, seed, new Uint8Array(0), te.encode(DOMAIN + info), 32);
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;
const fieldOf = (domain, canonical) => BigInt("0x" + toHex(sha256(te.encode(`layers-zk-field/1|${domain}|${canonical}`)))) >> 8n;
const scopeString = (feature, epoch, personaId) => (personaId === undefined ? `layers/zk-scope/v1|${feature}|${epoch}` : `layers/zk-scope/v1|${feature}|${epoch}|${personaId}`);
const nullifierFor = (scopeValue, secret) => poseidon2([semaphoreHash(scopeValue), secret]);
const historyEntryHash = (e) => createHash("sha256").update(["layers-zk-root-history/1", e.mode, e.tree, String(e.epoch), e.root, e.prevHash].join("|")).digest("hex");
const placementCanonical = (p) => ["layers-zk-placement/1", p.mode, p.tree, String(p.epoch), p.commitment, String(p.leafIndex), p.root].join("|");
const canonicalPublicInputs = (p) => ["layers-zk-public/1", p.mode, p.claimKind, p.tree, String(p.epoch), p.merkleTreeRoot, p.scope, p.message, p.personaId, p.gateId, p.challenge].join("|");
const fixtureTag = (canonical, nullifier) => createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, "layers-zk-fixture-tag/v1"].join("|")).digest("hex");
const verifySig = (sigHex, canonical, pubHex) => { try { return ed25519.verify(Buffer.from(sigHex, "hex"), te.encode(canonical), Buffer.from(pubHex, "hex")); } catch { return false; } };

const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status(), json };
}
async function vapi(method, url, body) {
  const res = await fetch(VBASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status, json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 120) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));

console.log("\nZK Gate 0 — identity branch, registration, signed trees, scopes, budget, fixture prover, pins, leak grep");

// ---- the suite's own derivation of the zk identity ----
function ownIdentity() {
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  const seed = new Uint8Array(Buffer.from(ks.rootSecretHex, "hex"));
  const master = kdf(seed, "zk-identity/1");
  const id = new Identity(master);
  return { master, id, needles: [toHex(master), id.secretScalar.toString(10), id.secretScalar.toString(16), id.export()] };
}

// ---- 0. clean store + clean zk universe + make sure the anchor exists ----
// resetSeed wipes adapter_state: check 5 asserts the validator holds NO
// anchor namespace, and rows a pre-fix build left behind would be a stale
// false positive, not evidence about this build.
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await new Promise((r) => setTimeout(r, 400));
await retry(() => zk("resetZk"));
{
  // the device-auth anchor must be registered for registration to verify
  // (armed deployments do this on first signed write; do it explicitly)
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "ab".repeat(32), deviceId: "dev_z0_probe" }));
  await vapi("POST", "/device/auth-anchor", { pubkey: issued.json.anchorPubKey });
  // a cohort: the client REFUSES to prove below its anonymity floor
  // (attack-2 finding 8), so the decoy crowd is seeded before anything
  // proves. Batched like every registration — check 4 asserts that.
  await retry(() => zk("seedDecoys", { count: 60 }));
}

// ---- 1. identity determinism (deliberate duplicate) ----
let commitment0 = null;
await check("1. zk identity: derived twice identical; suite's independent derivation matches the app's commitment", async () => {
  const p = (await retry(() => zk("probe"))).json;
  if (!p.derivedTwiceIdentical) throw new Error("same seed derived two different commitments");
  const { id } = ownIdentity();
  if (id.commitment.toString(10) !== p.commitment) throw new Error("suite-derived commitment != app commitment (kdf branch or identity construction drifted)");
  if (!(p.zkNeedleCount >= 5)) throw new Error("zk needle set implausibly small");
  commitment0 = p.commitment;
});

// ---- 2. SAFETY: ceremony + vkey pins ----
await check("2. SAFETY: bundled vkey matches the build pin AND the recorded ceremony verification; cached artifacts (if any) hash-match", async () => {
  const s = await status();
  if (!s.vkeyPin?.ok) throw new Error(`vkey pin check failed: ${s.vkeyPin?.reason}`);
  const rec = JSON.parse(readFileSync("research/zk-ceremony-verification.json", "utf8"));
  const onDisk = createHash("sha256").update(readFileSync("node_modules/@semaphore-protocol/proof/src/verification-keys.json")).digest("hex");
  if (onDisk !== rec.artifactsShipped.verificationKeyBundle.sha256) throw new Error("vkey on disk != recorded ceremony verification");
  if (onDisk !== s.vkeyPin.expectedSha256) throw new Error("code pin != recorded verification");
  // PERSONA LAUNCH P7 (verify, harness follows the code): the pins moved VERBATIM into lib/zk/ceremonyPins.ts (plain data,
  // no imports, so the browser's Web Worker prover bundles the same numbers) and ceremony.ts re-exports them. The check
  // keeps its teeth: every recorded hash must be in ceremonyPins.ts, ceremony.ts must take ARTIFACT_PINS from there (a
  // re-export AND the import its checks use), and ceremony.ts must hold NO other 64-hex pin of its own (a second, stale
  // copy that its checks could read instead would turn this red).
  const pins = readFileSync("lib/zk/ceremonyPins.ts", "utf8");
  const src = readFileSync("lib/zk/ceremony.ts", "utf8");
  for (const h of [rec.artifactsShipped.zkey.sha256, rec.artifactsShipped.wasm.sha256, rec.artifactsShipped.zkey.blake2b512]) {
    if (!pins.includes(h)) throw new Error("a recorded artifact hash is not pinned in lib/zk/ceremonyPins.ts");
  }
  if (!/export\s*\{[^}]*\bARTIFACT_PINS\b[^}]*\}\s*from\s*["']\.\/ceremonyPins["']/.test(src)) throw new Error("lib/zk/ceremony.ts does not re-export ARTIFACT_PINS from ./ceremonyPins");
  if (!/import\s*\{[^}]*\bARTIFACT_PINS\b[^}]*\}\s*from\s*["']\.\/ceremonyPins["']/.test(src)) throw new Error("lib/zk/ceremony.ts does not import the ARTIFACT_PINS its checks use from ./ceremonyPins");
  if (/\b[0-9a-f]{64}\b/.test(src)) throw new Error("lib/zk/ceremony.ts holds a hex pin of its own beside ./ceremonyPins (a second copy)");
  if (!rec.verified.ceremonyFinalZkeyByteIdenticalToCdnZkey_depth20) throw new Error("record says the CDN zkey was NOT byte-identical to the ceremony's — Gate 0 must STOP");
  if (s.artifactsCached && !(s.artifactsCached.wasm && s.artifactsCached.zkey)) throw new Error("a cached artifact fails its pin");
});

// ---- 3. registration: account-level, one per root, never from a persona context ----
let epochRegistered = null;
await check("3. Registration: device-auth signed, batched to the NEXT epoch, idempotent, one-per-root; REFUSED from a persona context; no rootId leaves", async () => {
  const r = await retry(() => zk("register"));
  if (!r.json.ok) throw new Error(`register refused: ${r.json.error}`);
  if (r.json.activeFromEpoch !== r.json.epochRegistered + 1) throw new Error("registration was not batched to the next epoch");
  epochRegistered = r.json.epochRegistered;
  const again = await retry(() => zk("register"));
  if (again.json.existing !== true) throw new Error("re-registration is not idempotent");
  const s = await status();
  if (!s.registration?.registered) throw new Error("status does not show the registration");
  if (JSON.stringify(s).match(/"rootId"\s*:/)) throw new Error("a rootId key leaked through /api/zk");
  // persona context: a view-as cookie → refused
  await viewAs("persona_acc_food_1");
  const fromPersona = await zk("register");
  await viewAs(null);
  if (fromPersona.status !== 400) throw new Error(`registration from a view-as context returned ${fromPersona.status}, expected 400`);
  const withPersona = await zk("register", { personaId: MAIN });
  if (withPersona.status !== 400) throw new Error(`registration naming a persona returned ${withPersona.status}, expected 400`);
});

// ---- 4. batching + signed placement + local tree rebuild ----
await check("4. Batching: not a leaf this epoch → a leaf after the epoch advances; placement signed by the validator, verified in-suite; local LeanIMT root == served root", async () => {
  const before = (await vapi("GET", "/zk/members?mode=fixture&tree=valid")).json;
  if (before.members.includes(commitment0)) throw new Error("commitment is already a leaf in the registration epoch — insertion was NOT batched");
  await retry(() => zk("advanceEpoch"));
  const after = (await vapi("GET", "/zk/members?mode=fixture&tree=valid")).json;
  if (!after.members.includes(commitment0)) throw new Error("commitment is not a leaf after the epoch advanced");
  const g = new Group(after.members.map((m) => BigInt(m)));
  if (g.root.toString(10) !== after.root) throw new Error("locally rebuilt root != served root");
  const key = (await vapi("GET", "/zk/validator-key")).json.pubkey;
  const pl = (await vapi("GET", `/zk/placement?mode=fixture&tree=valid&commitment=${commitment0}`)).json.placement;
  if (!pl) throw new Error("no signed placement for our commitment");
  if (pl.leafIndex !== g.indexOf(BigInt(commitment0))) throw new Error("placement leafIndex != local index");
  if (!verifySig(pl.sig, placementCanonical(pl), key)) throw new Error("placement signature does not verify with the duplicate canonical");
  if (verifySig(pl.sig, placementCanonical({ ...pl, leafIndex: pl.leafIndex + 1 }), key)) throw new Error("a tampered placement still verifies");
  // resetZk (check 1) cleared the device pins; the validator key is re-pinned
  // by the next scheduled prefetch tick (first sight, attack-3 F-11), so a
  // status read that lands before that tick honestly says "no pin yet". Wait
  // for the pin, then require the placement to verify AGAINST it.
  let s = await status();
  for (let i = 0; i < 30 && !s.placement?.keyPinned; i++) { await sleep(500); s = await status(); }
  if (!s.placement?.keyPinned) throw new Error("the validator key was not re-pinned within 15 s of the reset (no prefetch tick?)");
  if (!s.placement?.verified) throw new Error("app-side placement verification failed against the pinned key: " + JSON.stringify(s.placement));
});

// ---- 5. signed append-only root history (F8) ----
let currentRoot = null;
await check("5. Root history: hash-chained + signed, verified in-suite; tamper breaks it; app refuses an unknown root and anchors the chain ON THE DEVICE (nothing about it on the validator)", async () => {
  const key = (await vapi("GET", "/zk/validator-key")).json.pubkey;
  const h = (await vapi("GET", "/zk/history?mode=fixture&tree=valid")).json;
  if (h.pubkey !== key) throw new Error("history reports a different key");
  let prev = null;
  for (const e of h.entries) {
    if (historyEntryHash(e) !== e.hash) throw new Error(`hash mismatch at epoch ${e.epoch}`);
    if (!verifySig(e.sig, e.hash, key)) throw new Error(`signature invalid at epoch ${e.epoch}`);
    if (prev && (e.prevHash !== prev.hash || !(e.epoch > prev.epoch))) throw new Error("chain link broken");
    prev = e;
  }
  currentRoot = prev.root;
  const t = { ...prev, root: "424242" };
  if (historyEntryHash(t) === t.hash) throw new Error("a tampered entry kept its hash");
  const good = (await zk("rootCheck", { tree: "valid", root: currentRoot })).json;
  if (!good.ok) throw new Error(`app refused the current root: ${good.reason}`);
  const bad = (await zk("rootCheck", { tree: "valid", root: "424242" })).json;
  if (bad.ok) throw new Error("app accepted a root that is NOT in the signed history");
  // the anchor and the validator key pin live ON THE DEVICE (attack-3 F-3):
  // the validator's store holds NO anchor namespace at all, and the pins
  // summary shows the key pinned + this tree anchored at the newest epoch
  const st = await vapi("GET", "/state/zkRootAnchor");
  if (Object.keys(st.json?.entries ?? {}).length !== 0) throw new Error("a zkRootAnchor namespace exists on the validator — the anchor must not be stored where the operator can delete it");
  if (!existsSync(".keystore/zk-pins.json")) throw new Error("no device-local pins file");
  const s = await status();
  if (!s.pins?.validatorKeyPinned) throw new Error("validator key is not pinned on the device");
  const a = s.pins.anchors?.["fixture:valid"];
  if (!a || a.lastEpoch !== prev.epoch || a.lastHash !== prev.hash) throw new Error(`device anchor for fixture:valid is missing or stale: ${JSON.stringify(a)}`);
  // a different validator key would be refused, not re-TOFU'd: the pin is global and explicit
  if (s.placement && s.placement.keyPinned !== true) throw new Error("placement verification does not use the pinned key");
});

// ---- 6. SAFETY: the scope-collision adversarial test ----
await check("6. SAFETY: scope collision — two personas of ONE root never share a nullifier unless the entry is onePerHuman; two roots never collide; app == suite", async () => {
  const { id } = ownIdentity();
  const other = new Identity("z0-other-root");
  const epoch = 4242;
  const reg = (await retry(() => zk("nullifierProbe", { items: [] }))).json.registry;
  if (!reg.length) throw new Error("empty scope registry");
  const items = [];
  for (const e of reg) {
    if (e.onePerHuman) items.push({ entryId: e.id, epoch }, { entryId: e.id, epoch: epoch + 1 });
    else items.push({ entryId: e.id, epoch, personaId: MAIN }, { entryId: e.id, epoch, personaId: ALT }, { entryId: e.id, epoch: epoch + 1, personaId: MAIN });
  }
  const app = (await retry(() => zk("nullifierProbe", { items }))).json.nullifiers;
  for (const e of reg) {
    const mine = (ep, persona) => nullifierFor(fieldOf("scope", scopeString(e.feature, ep, persona)), id.secretScalar).toString(10);
    const theirs = (ep, persona) => nullifierFor(fieldOf("scope", scopeString(e.feature, ep, persona)), other.secretScalar).toString(10);
    if (e.onePerHuman) {
      // siblings COLLIDE by design (personaId is not in scope) — equal for A and B
      const a = mine(epoch, undefined), b = mine(epoch, undefined);
      if (a !== b) throw new Error(`${e.id}: onePerHuman scope is not stable`);
      if (mine(epoch + 1, undefined) === a) throw new Error(`${e.id}: epochs do not separate nullifiers`);
      if (theirs(epoch, undefined) === a) throw new Error(`${e.id}: two different roots collided`);
      const got = app.find((n) => n.entryId === e.id && n.epoch === epoch && n.personaId === null);
      if (!got || got.nullifier !== a) throw new Error(`${e.id}: app nullifier != suite nullifier`);
    } else {
      const a = mine(epoch, MAIN), b = mine(epoch, ALT);
      if (a === b) throw new Error(`${e.id}: TWO PERSONAS OF ONE ROOT SHARE A NULLIFIER — the attribution table is rebuilt in math`);
      if (mine(epoch + 1, MAIN) === a) throw new Error(`${e.id}: epochs do not separate nullifiers`);
      if (theirs(epoch, MAIN) === a) throw new Error(`${e.id}: two different roots collided at the same scope`);
      const got = app.find((n) => n.entryId === e.id && n.epoch === epoch && n.personaId === MAIN);
      if (!got || got.nullifier !== a) throw new Error(`${e.id}: app nullifier != suite nullifier (${got?.error ?? "missing"})`);
    }
  }
  // misuse fails CLOSED in both directions
  const misuse = (await retry(() => zk("nullifierProbe", { items: [{ entryId: "discovery-tier", epoch }, { entryId: "one-human-attest", epoch, personaId: MAIN }] }))).json.nullifiers;
  if (!misuse.every((m) => m.nullifier === null && m.error)) throw new Error("scope misuse (missing/extra personaId) did not fail closed");
});

// ---- 7. proof-history budget: a hard refusal ----
await check("7. Proof-history budget: N distinct predicates per epoch, then a HARD refusal (429); same predicate is idempotent", async () => {
  const epoch = 777777;
  const persona = "persona_budget_probe";
  const a = await zk("budgetProbe", { personaId: persona, epoch, claimKind: "k1" });
  const b = await zk("budgetProbe", { personaId: persona, epoch, claimKind: "k2" });
  if (!a.json.ok || !b.json.ok) throw new Error("first two predicates refused");
  const c = await zk("budgetProbe", { personaId: persona, epoch, claimKind: "k3" });
  if (c.status !== 429 || c.json.ok) throw new Error(`third predicate was NOT refused (${c.status})`);
  const again = await zk("budgetProbe", { personaId: persona, epoch, claimKind: "k1" });
  if (!again.json.ok) throw new Error("re-proving an already-counted predicate was refused");
  const st = (await zk("budgetProbe", { personaId: persona, epoch })).json.status;
  if (st.remaining !== 0 || st.used.length !== 2) throw new Error(`budget status wrong: ${JSON.stringify(st)}`);
});

// ---- 8. fixture prover: full lifecycle + every fail-closed branch ----
let envelope = null;
await check("8. Fixture prover: prove→self-verify→submit; tampered signals, wrong mode, unknown kind, malformed body all REFUSED; replay 409; forged wrong-root envelope refused by the validator", async () => {
  const out = await zk("prove", { claimKind: "tier-membership", tree: "valid", personaId: MAIN, gateId: "foryou" });
  if (!out.json.ok) throw new Error(`prove refused at stage ${out.json.stage}: ${out.json.reason}`);
  envelope = out.json.envelope;
  if (envelope.mode !== "fixture" || envelope.publicInputs.merkleTreeRoot !== currentRoot) throw new Error("envelope is not against the verified current root");
  const { id } = ownIdentity();
  // the envelope's nullifier IS the real formula over the real secret
  const expected = nullifierFor(BigInt(envelope.publicInputs.scope), id.secretScalar).toString(10);
  if (envelope.nullifier !== expected) throw new Error("fixture nullifier != Poseidon(hash(scope), secret)");
  const v = (await zk("verify", { envelope })).json;
  if (!v.ok) throw new Error(`self-verify failed: ${v.reason}`);
  const tamper = { ...envelope, publicInputs: { ...envelope.publicInputs, message: "1" } };
  if ((await zk("verify", { envelope: tamper })).json.code !== "TAMPER") throw new Error("tampered message accepted");
  const wrongMode = { ...envelope, mode: "live", publicInputs: { ...envelope.publicInputs, mode: "live" } };
  if ((await zk("verify", { envelope: wrongMode })).json.ok) throw new Error("live-universe envelope accepted by the fixture verifier");
  const unknownKind = { ...envelope, claimKind: "everything", publicInputs: { ...envelope.publicInputs, claimKind: "everything" } };
  if ((await zk("verify", { envelope: unknownKind, claimKind: "everything" })).json.ok) throw new Error("unknown claim kind did not fail closed");
  const malformed = { ...envelope, proof: { scheme: "layers-zk-fixture/1" } };
  if ((await zk("verify", { envelope: malformed })).json.code !== "MALFORMED") throw new Error("malformed proof body accepted");
  // submit → accepted once; replay → 409
  const s1 = (await retry(() => zk("submit", { envelope }))).json;
  if (s1.status !== 200) throw new Error(`submit refused: ${s1.status} ${JSON.stringify(s1.response)}`);
  const s2 = (await retry(() => zk("submit", { envelope }))).json;
  if (s2.status !== 409) throw new Error(`replay returned ${s2.status}, expected 409`);
  // a FORGED envelope (the toy tag is forgeable by design) against a root
  // outside the signed history — with its message honestly bound to that
  // root — must still be refused by the validator's ROOT check
  const pi = envelope.publicInputs;
  const forgedPub = { ...pi, merkleTreeRoot: "424242", message: fieldOf("message", [pi.personaId, pi.gateId, pi.challenge, "424242"].join("|")).toString(10) };
  const forged = { ...envelope, nullifier: "31337", proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(forgedPub), "31337") } };
  forged.publicInputs = forgedPub;
  const s3 = (await retry(() => zk("submit", { envelope: forged }))).json;
  if (s3.status !== 400 || !/signed history root/.test(s3.response?.error ?? "")) throw new Error(`wrong-root envelope returned ${s3.status}: ${JSON.stringify(s3.response)}`);
  // THE CLAIM BINDING (attack-2 #1): the same valid proof material
  // re-labelled to a sibling persona — tag re-minted so only the binding
  // can catch it — is REFUSED, and a padded nullifier is not a fresh one
  const relabelledPub = { ...pi, personaId: ALT };
  const relabelled = { ...envelope, nullifier: "31338", publicInputs: relabelledPub, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(relabelledPub), "31338") } };
  const s5 = (await retry(() => zk("submit", { envelope: relabelled }))).json;
  if (s5.status !== 400 || !/canonical derivation/.test(s5.response?.error ?? "")) throw new Error(`a proof re-labelled to another persona returned ${s5.status}: ${JSON.stringify(s5.response)}`);
  const padded = { ...envelope, nullifier: "0" + envelope.nullifier, proof: { scheme: "layers-zk-fixture/1", tag: fixtureTag(canonicalPublicInputs(pi), "0" + envelope.nullifier) } };
  const s6 = (await retry(() => zk("submit", { envelope: padded }))).json;
  if (s6.status !== 400) throw new Error(`a leading-zero nullifier was not refused (${s6.status})`);
  // a second persona of the same root gets a DIFFERENT nullifier and is accepted
  const alt = await zk("prove", { claimKind: "tier-membership", tree: "valid", personaId: ALT, gateId: "foryou" });
  if (!alt.json.ok) throw new Error(`alt prove refused: ${alt.json.reason}`);
  if (alt.json.envelope.nullifier === envelope.nullifier) throw new Error("sibling personas share a nullifier");
  const s4 = (await retry(() => zk("submit", { envelope: alt.json.envelope }))).json;
  if (s4.status !== 200) throw new Error(`sibling submit refused: ${s4.status}`);
});

// ---- 9. the anonymity-set floor is computed from the tree ----
await check("9. Anonymity floor: computed by the CLIENT from the leaves — more decoys (batched to the next epoch; the frozen epoch's root does not move) keep 'valid' over the floor; a thin tier stays under; the prove path REFUSES a thin cohort", async () => {
  const s0 = await status();
  const floor = s0.floor;
  if (s0.floorSource !== "client") throw new Error("the floor is not the client's");
  // a THIN cohort is a refusal on the prove path, not a label note
  const thin = await zk("prove", { claimKind: "tier-membership", tree: "tier-10", personaId: MAIN, gateId: "foryou" });
  if (thin.status !== 422 || thin.json.stage !== "cohort") throw new Error(`proving into a thin cohort was not refused at the cohort stage: ${thin.status} ${JSON.stringify(thin.json).slice(0, 140)}`);
  const rootBefore = (await vapi("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "valid").root;
  await retry(() => zk("seedDecoys", { count: floor + 30 }));
  const rootStill = (await vapi("GET", "/zk/trees?mode=fixture")).json.trees.find((t) => t.tree === "valid").root;
  if (rootStill !== rootBefore) throw new Error("FROZEN-EPOCH INVARIANT: seeding moved the current epoch's signed root");
  await retry(() => zk("advanceEpoch"));
  const trees = (await vapi("GET", "/zk/trees?mode=fixture")).json.trees;
  const valid = trees.find((t) => t.tree === "valid");
  if (!(valid.size >= floor) || !valid.clearsFloor) throw new Error(`valid tree ${valid.size} did not clear the floor ${floor}`);
  const top = trees.find((t) => t.tree === "tier-10");
  if (top.clearsFloor !== top.size >= floor) throw new Error("clearsFloor is not derived from size");
  if (top.clearsFloor) throw new Error("tier-10 cleared the floor with a thin cohort — the spread is wrong");
});

// ---- 10. recovery reproduces the identical commitment ----
await check("10. Recovery: the phrase's seed reproduces the identical commitment after TOTAL device loss; the registration stays valid", async () => {
  const got = await retry(() => api("POST", "/api/recovery", { action: "revealPhrase", acknowledged: true }));
  const phrase = got.json.phrase;
  const pre = (await zk("recoveryProbe", { phrase })).json;
  if (!pre.matches) throw new Error("the current phrase does not reproduce the current commitment");
  await retry(() => api("POST", "/api/dev", { action: "simulateDeviceLoss" }));
  const lost = (await retry(() => zk("probe"))).json.commitment;
  if (lost === commitment0) throw new Error("a fresh blank root produced the SAME commitment — determinism is fake");
  await retry(() => api("POST", "/api/recovery", { action: "recover", phrase }));
  const back = (await retry(() => zk("probe"))).json.commitment;
  if (back !== commitment0) throw new Error("recovered commitment != original commitment");
  const s = await status();
  if (!s.registration?.registered) throw new Error("registration not visible after recovery");
});

// ---- 11. SAFETY: zk secret material appears NOWHERE outward ----
await check("11. SAFETY: zk master / secret scalar / private-key export appear in no app or validator surface", async () => {
  const { needles } = ownIdentity();
  if (needles.length < 4) throw new Error("needle set implausibly small");
  const surfaces = [
    ["GET /api/zk", JSON.stringify((await api("GET", "/api/zk?mode=fixture")).json)],
    ["probe", JSON.stringify((await zk("probe")).json)],
    ["nullifierProbe", JSON.stringify((await zk("nullifierProbe", { items: [{ entryId: "discovery-tier", epoch: 1, personaId: MAIN }] })).json)],
    ["prove envelope", JSON.stringify(envelope)],
    ["GET /api/dev", JSON.stringify((await api("GET", "/api/dev")).json)],
    ["GET /api/personas", JSON.stringify((await api("GET", "/api/personas")).json)],
    ["validator /state", JSON.stringify((await vapi("GET", "/state")).json)],
    ["validator /zk/trees", JSON.stringify((await vapi("GET", "/zk/trees?mode=fixture")).json)],
    ["validator /zk/history", JSON.stringify((await vapi("GET", "/zk/history?mode=fixture&tree=valid")).json)],
    ["validator /zk/members", JSON.stringify((await vapi("GET", "/zk/members?mode=fixture&tree=valid")).json)],
  ];
  for (const [name, payload] of surfaces) for (const n of needles) if (payload.includes(n)) throw new Error(`zk secret material found in ${name}`);
});

await viewAs(null);
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Gate 0 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
