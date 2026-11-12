// ATTESTATION PASS Gate 1 — the open issuer interface, on the mock issuer.
// FIXTURE-ONLY (ZK_DEV_HOOKS=true on both processes).
//
//   1. REGISTRY: the mock issuer registers itself (self-signed) with a
//      schema, buckets and a key; the same id under another key is 409;
//      a registration with a bad signature is refused
//   2. ISSUE → BATCH: an issuance lands in attest:<issuer>/<bucket> NEXT
//      epoch, never this one; the cohort clears the client floor
//   3. THE VALUE NEVER REACHES THE VALIDATOR: the claim's random token is
//      in our vault (decrypted through the product path) and NOWHERE in
//      the validator's database, WAL, log or any response; the vault
//      namespace is one opaque sealed record; the issuer's private key is
//      nowhere either
//   4. PROVE → ATTESTED: a persona proves the bucket and reads "attested"
//      with the bucket named
//   5. ISSUER SIGNATURE / EXPIRY / BUCKET: a tampered signature, a wrong
//      expiry, an undeclared bucket and an unregistered issuer are refused
//   6. SCOPE COLLISION with buckets: the same persona proves a second
//      bucket of the same issuer in the same epoch — accepted (distinct
//      nullifier), and the two nullifiers on the validator differ
//   7. SUBSCRIBER ALLOWLIST: an un-honoured issuer's attestation proves
//      nothing on this client — the gate refuses to schedule, "attested"
//      reads false while the validator's log says otherwise
//   8. EXPIRE → REFUSED: past expiry the leaf is gone, the proof is
//      refused client-side, the mark lapses
//   9. ISSUER REVOCATION removes exactly that leaf next epoch
//  10. API.md documents the interface
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const ISSUER = "test.mock-issuer";
const TREE = (b) => `attest:${ISSUER}/${b}`;

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
async function vapi(p, init) { const r = await fetch(VBASE + p, init); return { status: r.status, json: await r.json().catch(() => null) }; }
async function vpost(p, body) { return vapi(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 300)); } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const treeOf = async (name) => (await vapi(`/zk/trees?mode=fixture`)).json.trees.find((t) => t.tree === name);
const advance = async () => { await retry(() => zk("advanceEpoch")); await retry(() => zk("prefetchNow")); await sleep(200); };
const proveVia = async (personaId, bucket) => {
  await retry(() => zk("requestAttestation", { personaId, issuer: ISSUER, bucket }));
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  return (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
};

console.log("\nAttestation pass Gate 1 — the open issuer interface (mock issuer)");

// ---- setup: a fresh fixture universe with a cohort, our commitment a leaf ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await retry(() => zk("resetZk"));
await retry(() => zk("setRepImpl", { impl: "zk" }));
await retry(() => zk("setHonoredIssuers", { issuers: [ISSUER] }));
await retry(() => zk("seedDecoys", { count: 60 }));
await retry(() => zk("register"));
await advance();
const FLOOR = (await status()).floor;

let issuerPub = null;
let token = null;

// ---- 1. registry ----
await check("1. REGISTRY: the mock issuer registers itself (self-signed) with a schema, two buckets and a key; the same id under ANOTHER key is 409; a bad registration signature is refused; the list is public", async () => {
  const first = (await retry(() => zk("issuers"))).json;
  if (first.issuers.some((i) => i.id === ISSUER)) throw new Error("the fixture registry was not empty after resetZk");
  const reg = (await retry(() => zk("registerIssuer", { issuerId: ISSUER }))).json;
  if (!reg.ok || !/^[0-9a-f]{64}$/.test(reg.pubkey ?? "")) throw new Error("registerIssuer: " + JSON.stringify(reg).slice(0, 200));
  issuerPub = reg.pubkey;
  const list = (await vapi(`/zk/issuers?mode=fixture`)).json;
  const me = list.issuers.find((i) => i.id === ISSUER);
  if (!me || me.pubkey !== issuerPub || !Array.isArray(me.buckets) || !me.buckets.includes("any") || !me.buckets.includes("alt") || me.validityEpochs !== 1 || me.trustTier !== "attested" || !me.claimSchema?.properties?.token)
    throw new Error("registry entry: " + JSON.stringify(me).slice(0, 300));
  if (me.registeredAt % 3_600_000 !== 0) throw new Error("registeredAt is finer than the hour");
  // another key for the same id
  const { generateKeyPairSync, sign, createHash } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const pub2 = spki.subarray(spki.length - 32).toString("hex");
  const schemaHash = createHash("sha256").update(JSON.stringify(me.claimSchema)).digest("hex");
  const canonical = ["layers-zk-issuer/1", "fixture", ISSUER, me.displayName, schemaHash, me.buckets.join(","), String(me.validityEpochs), pub2].join("|");
  const sig2 = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
  const taken = await vpost("/zk/issuers", { mode: "fixture", id: ISSUER, displayName: me.displayName, claimSchema: me.claimSchema, buckets: me.buckets, validityEpochs: me.validityEpochs, pubkey: pub2, sig: sig2 });
  if (taken.status !== 409) throw new Error("same id under another key was not 409: " + taken.status + " " + JSON.stringify(taken.json));
  const badSig = await vpost("/zk/issuers", { mode: "fixture", id: "test.other-issuer", displayName: "x", claimSchema: { type: "object" }, buckets: ["any"], validityEpochs: 1, pubkey: pub2, sig: sig2 });
  if (badSig.status !== 400 || !/signature/.test(badSig.json?.error ?? "")) throw new Error("bad registration signature not refused: " + badSig.status + " " + JSON.stringify(badSig.json));
  // idempotent re-registration under the same key
  const again = (await retry(() => zk("registerIssuer", { issuerId: ISSUER }))).json;
  if (!again.ok || again.existing !== true) throw new Error("re-registration was not idempotent: " + JSON.stringify(again));
});

// ---- 2. issue → batch ----
await check("2. ISSUE → BATCH: the issuance (and the cohort's) lands in attest:test.mock-issuer/any NEXT epoch, never this one; the tree then clears the client floor; the issuance names the bucket, an activation epoch and a quantized expiry", async () => {
  const E = (await status()).epoch;
  const r = (await retry(() => zk("attest", { issuer: ISSUER, includeDecoys: true }))).json.response;
  if (r?.ok !== true || r.mock !== true || r.activeFromEpoch !== E + 1 || r.expiresEpoch !== E + 2 || !(r.decoysAttested >= FLOOR) || r.accepted < FLOOR + 1) throw new Error("attest: " + JSON.stringify(r).slice(0, 300));
  const mine = (await retry(() => zk("attestations"))).json.attestations.find((x) => x.issuer === ISSUER && x.bucket === "any");
  if (!mine || mine.activeNow !== false || mine.activeFromEpoch !== E + 1 || mine.expiresEpoch !== E + 2 || !/^[0-9a-f]{64}$/.test(mine.claimHash)) throw new Error("attestations read: " + JSON.stringify(mine));
  const before = await treeOf(TREE("any"));
  if (before && before.size > 0) throw new Error("the attest tree already has leaves in the issuing epoch (not batched)");
  await advance();
  const tree = await treeOf(TREE("any"));
  if (!tree || tree.size < FLOOR + 1) throw new Error("attest tree not issued with the cohort next epoch: " + JSON.stringify(tree));
  const census = (await vapi(`/zk/attest/buckets?mode=fixture`)).json.buckets.find((b) => b.issuer === ISSUER && b.bucket === "any");
  if (!census || census.size !== tree.size) throw new Error("bucket census disagrees with the tree: " + JSON.stringify(census));
});

// ---- 3. the value never reaches the validator ----
await check("3. THE VALUE NEVER REACHES THE VALIDATOR: the claim's random token is in OUR vault (read through the product path) and nowhere in the validator's database, WAL, log, or the registry/issuance responses; the vault namespace is one opaque sealed record; the issuer's private key is nowhere", async () => {
  const mine = (await retry(() => zk("myAttestations"))).json.attestations.find((a) => a.issuerId === ISSUER && a.bucket === "any");
  if (!mine || typeof mine.claim?.value?.token !== "string" || mine.claim.value.token.length < 8 || !/^[0-9a-f]{64}$/.test(mine.claim.nonce)) throw new Error("our vault does not hold the claim value: " + JSON.stringify(mine).slice(0, 200));
  token = mine.claim.value.token;
  const needles = [token, mine.claim.nonce];
  const dbDir = path.join(process.cwd(), "validator");
  for (const f of ["layers.db", "layers.db-wal"]) {
    const p = path.join(dbDir, f);
    if (!existsSync(p)) continue;
    const bytes = readFileSync(p);
    for (const n of needles) if (bytes.includes(Buffer.from(n, "utf8")) || bytes.includes(Buffer.from(n, "latin1"))) throw new Error(`${f} contains the claim ${n === token ? "value" : "nonce"}`);
  }
  const logs = [process.env.TEMP && path.join(process.env.TEMP, "layers-validator.log"), path.join(dbDir, "deaths.log")].filter((p) => p && existsSync(p));
  for (const p of logs) { const s = readFileSync(p, "utf8"); for (const n of needles) if (s.includes(n)) throw new Error(`${path.basename(p)} contains a claim needle`); }
  for (const p of ["/zk/issuers?mode=fixture", "/zk/attest/buckets?mode=fixture", `/zk/attestations?mode=fixture&commitment=${encodeURIComponent((await status()).commitment)}`]) {
    const body = JSON.stringify((await vapi(p)).json);
    for (const n of needles) if (body.includes(n)) throw new Error(`${p} leaks a claim needle`);
  }
  // the vault namespace on the validator: ciphertext under the single address "_"
  const st = (await vapi(`/state/zkAttestations`)).json;
  const ids = Object.keys(st?.entries ?? {});
  if (ids.length !== 1 || ids[0] !== "_") throw new Error("zkAttestations is not one opaque record: " + JSON.stringify(ids));
  if (JSON.stringify(st).includes(token)) throw new Error("the sealed record contains the token in the clear");
  // the issuer's private key: nowhere in responses or the db
  const keyDir = path.join(process.cwd(), ".keystore", "issuers");
  const privs = existsSync(keyDir) ? readdirSync(keyDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(keyDir, f), "utf8")).privHex).filter(Boolean) : [];
  if (privs.length === 0) throw new Error("no issuer key on disk to grep for");
  const db = readFileSync(path.join(dbDir, "layers.db"));
  for (const k of privs) { if (db.includes(Buffer.from(k, "utf8"))) throw new Error("issuer private key is in the validator db"); if (JSON.stringify(st).includes(k)) throw new Error("issuer private key is in the vault record"); }
});

// ---- 4. prove → attested ----
await check("4. PROVE → ATTESTED: MAIN proves attest:test.mock-issuer/any from the tick's snapshot; 'attested' reads true and names the bucket; the attempt log records the claim", async () => {
  const d = await proveVia(MAIN, "any");
  const at = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER, bucket: "any" }))).json;
  if (at.attested !== true || !at.buckets?.includes("any")) throw new Error("MAIN is not attested after proving: " + JSON.stringify(at) + " drain=" + JSON.stringify(d).slice(0, 200));
  const any = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER }))).json;
  if (any.attested !== true || !any.buckets?.includes("any")) throw new Error("issuer-level attested read: " + JSON.stringify(any));
  const attempts = (await retry(() => zk("gateStatus"))).json.attempts;
  if (!attempts.some((x) => x.personaId === MAIN && x.claimKind === "attestation" && x.queuedId)) throw new Error("no attestation proof attempt recorded");
  const map = (await retry(() => zk("attestedMap"))).json;
  if (!map.claims?.[MAIN]?.includes(`${ISSUER}/any`)) throw new Error("attested map lacks MAIN's claim: " + JSON.stringify(map).slice(0, 200));
});

// ---- 5. issuer signature / expiry / bucket ----
await check("5. REFUSALS: a tampered issuer signature, a wrong (per-subject) expiry, an undeclared bucket, and an unregistered issuer are all refused by the validator, by index, naming no value", async () => {
  // a CURRENT-epoch issuance to tamper with (Gate 4: there is no issue-epoch grace, so a stale one is refused before its parts are read)
  await retry(() => zk("attest", { issuer: ISSUER }));
  const mine = (await retry(() => zk("myAttestations"))).json.attestations.find((a) => a.issuerId === ISSUER && a.bucket === "any");
  const pub = { issuer: ISSUER, bucket: "any", commitment: mine.subjectCommitment, claimHash: mine.claimHash, issuedEpoch: mine.issueEpoch, expiresEpoch: mine.expiryEpoch, sig: mine.sig };
  const flip = (hex) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
  // through the device signature (Gate 4: a raw unsigned batch is refused before any part is read)
  const raw = await vpost("/zk/attest", { mode: "fixture", attestations: [pub] });
  if (raw.status !== 400 && raw.status !== 403) throw new Error("an unsigned batch was accepted: " + raw.status);
  const r = await zk("attestSubmitRaw", { attestations: [
    { ...pub, sig: flip(pub.sig) },
    { ...pub, expiresEpoch: pub.expiresEpoch + 1 },
    { ...pub, bucket: "undeclared" },
    { ...pub, issuer: "test.nobody" },
  ] });
  if (r.status !== 400 || r.json?.accepted !== 0 || r.json?.refused?.length !== 4) throw new Error("expected 4 refusals: " + r.status + " " + JSON.stringify(r.json).slice(0, 300));
  const reasons = r.json.refused.map((x) => x.error);
  if (!/signature/.test(reasons[0]) || !/expiresEpoch|quantized/.test(reasons[1]) || !/bucket/.test(reasons[2]) || !/not registered/.test(reasons[3])) throw new Error("refusal reasons: " + JSON.stringify(reasons));
  if (token && JSON.stringify(r.json).includes(token)) throw new Error("a refusal named the claim value");
});

// ---- 6. scope collision with buckets ----
await check("6. SCOPE COLLISION: MAIN proves a SECOND bucket (alt) of the same issuer in the same epoch — accepted, and the two claims' nullifiers on the validator differ (issuer AND bucket qualify the scope)", async () => {
  const E = (await status()).epoch;
  const r = (await retry(() => zk("attest", { issuer: ISSUER, buckets: ["alt"], includeDecoys: true }))).json.response;
  if (r?.ok !== true || r.activeFromEpoch !== E + 1) throw new Error("alt issuance: " + JSON.stringify(r).slice(0, 200));
  await advance();
  const altTree = await treeOf(TREE("alt"));
  if (!altTree || altTree.size < FLOOR + 1) throw new Error("alt tree: " + JSON.stringify(altTree));
  // MAIN's "any" from the previous epoch lapses with the grace; prove both this epoch
  await proveVia(MAIN, "any");
  await proveVia(MAIN, "alt");
  const both = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER }))).json;
  if (!both.buckets?.includes("any") || !both.buckets?.includes("alt")) throw new Error("both buckets not attested: " + JSON.stringify(both));
  const probe = (await retry(() => zk("nullifierProbe", { claimKind: "attestation", personaId: MAIN, issuer: ISSUER, buckets: ["any", "alt"] }))).json;
  if (!probe.nullifiers || probe.nullifiers.any === probe.nullifiers.alt) throw new Error("the two buckets share a nullifier: " + JSON.stringify(probe).slice(0, 200));
});

// ---- 7. subscriber allowlist ----
await check("7. SUBSCRIBER ALLOWLIST: with the mock issuer un-honoured, the gate refuses to schedule a proof (attempt log says 'not honoured') and 'attested' reads false on this client while the validator's log still says attested; honouring it again restores the read", async () => {
  await retry(() => zk("setHonoredIssuers", { issuers: ["onchain.*"] }));
  const sched = (await zk("requestAttestation", { personaId: ALT, issuer: ISSUER, bucket: "any" })).json;
  if (sched.scheduled !== false || !/honou?r/.test(sched.reason ?? "")) throw new Error("un-honoured issuer was scheduled: " + JSON.stringify(sched));
  const attempts = (await retry(() => zk("gateStatus"))).json.attempts;
  if (!attempts.some((x) => x.personaId === ALT && x.claimKind === "attestation" && x.ok === false && /honou?r/.test(x.reason ?? ""))) throw new Error("no 'not honoured' attempt recorded");
  const clientRead = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER }))).json;
  if (clientRead.attested !== false || clientRead.honored !== false) throw new Error("un-honoured issuer read as attested on this client: " + JSON.stringify(clientRead));
  const validatorSays = (await vapi(`/zk/attested-map?mode=fixture`)).json;
  // (armed deployments gate this read; either the map names MAIN or the read is refused — both are fine, the CLIENT is what must say false)
  if (validatorSays?.claims && !validatorSays.claims[MAIN]) throw new Error("the validator lost MAIN's claim");
  await retry(() => zk("setHonoredIssuers", { issuers: [ISSUER] }));
  const restored = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER }))).json;
  if (restored.attested !== true) throw new Error("honouring again did not restore the read: " + JSON.stringify(restored));
});

// ---- 8. expiry ----
await check("8. EXPIRE → REFUSED: past the quantized expiry the leaves are gone, a proof is refused client-side (cohort/membership), and the 'attested' mark lapses after the grace", async () => {
  await advance();
  await advance();
  const expired = await treeOf(TREE("any"));
  if (!expired || expired.size !== 0) throw new Error("the attest tree still has leaves after expiry: " + JSON.stringify(expired));
  const refused = (await zk("prove", { claimKind: "attestation", tree: TREE("any"), personaId: ALT, gateId: TREE("any"), issuer: ISSUER, bucket: "any" })).json;
  if (refused.ok !== false || !["cohort", "membership"].includes(refused.stage)) throw new Error("an expired attestation did not fail at cohort/membership: " + JSON.stringify(refused).slice(0, 200));
  const lapsed = (await retry(() => zk("attested", { personaId: MAIN, issuer: ISSUER }))).json;
  if (lapsed.attested !== false) throw new Error("the attested mark did not lapse after expiry: " + JSON.stringify(lapsed));
});

// ---- 9. issuer revocation ----
await check("9. ISSUER REVOCATION (a second issuer, 3-epoch validity, so the issuance outlives the revocation): a fresh issuance for us and the cohort; the issuer revokes OURS (signed); next epoch the tree lost exactly our leaf, the cohort's remain, and a re-issuance restores it the epoch after", async () => {
  const LONG = "test.mock-issuer-long";
  const LTREE = `attest:${LONG}/any`;
  await retry(() => zk("setHonoredIssuers", { issuers: [ISSUER, LONG] }));
  const r = (await retry(() => zk("attest", { issuer: LONG, includeDecoys: true }))).json.response;
  if (r?.ok !== true) throw new Error("issuance: " + JSON.stringify(r).slice(0, 200));
  const two = (await vapi(`/zk/issuers?mode=fixture`)).json.issuers.filter((i) => i.id === ISSUER || i.id === LONG);
  if (two.length !== 2 || two[0].validityEpochs === two[1].validityEpochs || two[0].pubkey === two[1].pubkey) throw new Error("two issuers with different validity/keys expected: " + JSON.stringify(two.map((i) => [i.id, i.validityEpochs])));
  await advance();
  const full = await treeOf(LTREE);
  const commitment = (await status()).commitment;
  const members = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(LTREE)}`)).json.members;
  if (!members.includes(commitment)) throw new Error("our leaf is not in the tree before revocation");
  const rv = (await retry(() => zk("revokeAttestation", { issuerId: LONG, bucket: "any" }))).json;
  if (rv.ok !== true || rv.revokedFromEpoch !== (await status()).epoch + 1) throw new Error("revoke: " + JSON.stringify(rv));
  const again = (await retry(() => zk("revokeAttestation", { issuerId: LONG, bucket: "any" }))).json;
  if (again.ok !== true || again.existing !== true) throw new Error("revocation is not idempotent: " + JSON.stringify(again));
  if ((await treeOf(LTREE)).size !== full.size) throw new Error("the frozen epoch's tree moved on revocation");
  await advance();
  const after = (await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(LTREE)}`)).json;
  if (after.members.includes(commitment)) throw new Error("our leaf survived the revocation");
  if (after.members.length !== full.size - 1) throw new Error(`revocation removed ${full.size - after.members.length} leaves, expected exactly 1`);
  const mine = (await retry(() => zk("attestations"))).json.attestations.find((x) => x.issuer === LONG && x.bucket === "any");
  if (!mine || mine.activeNow !== false || !Number.isInteger(mine.revokedFromEpoch)) throw new Error("attestations read after revocation: " + JSON.stringify(mine));
  // re-issuance clears the revocation, batched
  const re = (await retry(() => zk("attest", { issuer: LONG }))).json.response;
  if (re?.ok !== true) throw new Error("re-issuance: " + JSON.stringify(re).slice(0, 200));
  if ((await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(LTREE)}`)).json.members.includes(commitment)) throw new Error("re-issuance was not batched");
  await advance();
  if (!(await vapi(`/zk/members?mode=fixture&tree=${encodeURIComponent(LTREE)}`)).json.members.includes(commitment)) throw new Error("re-issuance did not restore the leaf");
});

// ---- 10. docs ----
await check("10. DOCS: validator/API.md documents the open issuer interface (registration, issuance, revocation, census, what the validator learns)", async () => {
  const s = readFileSync("validator/API.md", "utf8");
  for (const needle of ["/zk/issuers", "/zk/attest", "/zk/attest/revoke", "/zk/attest/buckets", "What the validator learns", "never the claim value"]) if (!s.includes(needle)) throw new Error("API.md lacks: " + needle);
});

await retry(() => zk("setHonoredIssuers", { issuers: null }));
// leave the app on its DEFAULT rep binding (the z8/z9 idiom): under the zk
// binding a persona created by the next suite is never proven within its
// wait — closing series 2 sweep 2 and series 3 sweep 2 both lost
// functional's tier-badge check to the binding this suite had left behind
await retry(() => zk("setRepImpl", { impl: null }));
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Attestation Gate 1 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exit(failed ? 1 : infra ? 2 : 0);
