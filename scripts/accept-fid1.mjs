// MULTI-FID PASS — Gate 1 acceptance: persona ↔ FID model + signer custody (fixture).
//   1. NETWORK MODE: per-persona-fid by default; shared-fid behind the flag; the rig switches and restores
//   2. ACQUIRE: two public personas (MAIN + a minted public persona) map to two DISTINCT fixture fids; one persona, one fid
//   3. PRIVATE personas never get a fid (ALT is the seeded private persona); a persona of another root is refused
//   4. SIGNERS: derivation deterministic (fc-signer/<nonce>), distinct per persona, equal to the record's key; custody addresses distinct
//   5. RECOVERY: after total device loss, the phrase reproduces the ROOT-derived persona's signer and custody address, and the map
//      (the seeded viewer persona's keys come off its fixture root — demo furniture, public by construction — and are stable regardless)
//   6. CUSTODY switches by config: self-custody records a simulated KeyGateway add of the DERIVED key; neynar-managed a managed signer
//   7. REGISTRANT LINKAGE: the two fids share no registrant/funder/custody that is not the sponsor; injected sharing is flagged
//   8. IDENTITY RULE: a third-party fid's credential is refused, a wrong signer is refused, a foreign-origin record is refused; own fids allowed
//   9. THE WRITE DOOR: a cast as MAIN goes out under MAIN's fid, as PUB2 under PUB2's; the private persona's cast goes through the SHARED account (never a persona fid); shared-fid mode never uses a persona's fid
//  10. WHAT THE VALIDATOR LEARNS: the plain map holds only { personaId → fid, fname }; the record namespace is ciphertext; the reset contract holds
// Fixture, pinned ports, no network, no spend.
import { readFileSync } from "node:fs";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt"; // the seeded PRIVATE persona (backyard_scope)
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = Array.isArray(seedAccounts) ? seedAccounts : seedAccounts.accounts ?? seedAccounts.personas ?? [];
const idOfHandle = (h) => seedList.find((p) => p.handle === h)?.id;
const FORK_SOURCE = idOfHandle("brothandbones"); // a seeded persona the viewer can fork (the c4 rig's choice)
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw last;
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const view = async () => (await retry(() => api("GET", "/api/fc/persona"))).json;
const write = (body) => api("POST", "/api/fc/write", body);
const reset = () => retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
/** a minted PUBLIC persona of this root (a fork of a seeded persona, carrying nothing) */
async function mintPublicPersona(tag) {
  // MULTI-FID Gate 3: in per-persona-fid mode a fork mints the new persona's fid itself. This suite is
  // ABOUT acquisition, so it mints under shared-fid (the product's own fid-less path) and restores the mode.
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  let forked;
  try { forked = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fid1_${tag}_${Date.now().toString(36).slice(-4)}` })); }
  finally { await retry(() => persona("setNetworkMode", { mode: null })); }
  const id = forked.json.newPersona;
  if (!id) throw new Error("fork did not mint a persona: " + JSON.stringify(forked.json).slice(0, 200));
  if (forked.json.newFid) throw new Error("a shared-fid fork minted a fid");
  return id;
}

await reset();
let PUB2 = await mintPublicPersona("pub");

// ---- 1. network mode ----
await check("1. NETWORK MODE: per-persona-fid by default; the rig switches to shared-fid (the Pass-FC v0, kept for anon-post mode) and restores the default; custody defaults to neynar-managed", async () => {
  const v = await view();
  if (v.networkMode !== "per-persona-fid") throw new Error("default mode: " + v.networkMode);
  if (v.custody !== "neynar-managed") throw new Error("default custody: " + v.custody);
  if (Object.keys(v.map).length !== 0) throw new Error("map not empty after reset: " + JSON.stringify(v.map));
  const sw = (await retry(() => persona("setNetworkMode", { mode: "shared-fid" }))).json;
  if (sw.networkMode !== "shared-fid") throw new Error("switch: " + JSON.stringify(sw));
  const back = (await retry(() => persona("setNetworkMode", { mode: null }))).json;
  if (back.networkMode !== "per-persona-fid") throw new Error("restore: " + JSON.stringify(back));
});

// ---- 2. acquire ----
let recMain, recPub;
await check("2. ACQUIRE (fixture): MAIN and a minted public persona map to two DISTINCT fids (9,000,000 + n), fname from the handle, origin fixture, registrant + funder = the sponsor; the record's Neynar signer uuid is never returned; a second acquisition for the same persona is refused", async () => {
  recMain = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
  recPub = (await retry(() => persona("acquire", { personaId: PUB2 }))).json.record;
  if (!recMain || !recPub) throw new Error("no records");
  if (recMain.fid === recPub.fid) throw new Error("same fid for both personas");
  if (recMain.fid < 9_000_000 || recPub.fid < 9_000_000) throw new Error("fixture fids must be 9,000,000+: " + recMain.fid + "," + recPub.fid);
  for (const r of [recMain, recPub]) {
    if (r.origin !== "fixture" || r.mode !== "fixture") throw new Error("origin/mode: " + JSON.stringify(r).slice(0, 200));
    if (r.registrant !== "neynar-sponsor" || r.funder !== "neynar-sponsor") throw new Error("registrant/funder: " + JSON.stringify(r).slice(0, 200));
    if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(r.fname ?? "")) throw new Error("fname grammar: " + r.fname);
    if (r.signer.kind !== "neynar-managed" || r.signer.uuid !== "<vault>") throw new Error("signer leaked or wrong kind: " + JSON.stringify(r.signer));
    if (!/^0x[0-9a-fA-F]{40}$/.test(r.custodyAddress)) throw new Error("custody address: " + r.custodyAddress);
  }
  const again = await persona("acquire", { personaId: MAIN });
  if (again.status !== 400 || !/already owns/.test(again.json?.reason ?? "")) throw new Error("second acquisition not refused: " + JSON.stringify(again.json));
  const v = await view();
  if (v.map[MAIN]?.fid !== recMain.fid || v.map[PUB2]?.fid !== recPub.fid) throw new Error("map: " + JSON.stringify(v.map));
});

// ---- 3. private / foreign personas ----
await check("3. PRIVATE personas never get a fid — the seeded private persona (ALT) is refused as private, whoever holds it; a persona of another root is refused as not ours", async () => {
  const priv = await persona("acquire", { personaId: ALT });
  if (priv.status !== 400 || !/private personas never get a fid/.test(priv.json?.reason ?? "")) throw new Error("private persona not refused as private: " + JSON.stringify(priv.json));
  const other = await persona("acquire", { personaId: "persona_acc_crypto_1" });
  if (other.status !== 400 || !/not one of this root/.test(other.json?.reason ?? "")) throw new Error("foreign persona not refused: " + JSON.stringify(other.json));
  const v = await view();
  if (v.map[ALT]) throw new Error("the private persona got a fid");
});

// ---- 4. signers ----
let sigMain, sigPub;
await check("4. SIGNERS: fc-signer/<nonce> derivation is deterministic (two probes agree), distinct per persona, and equals the recorded derived key; custody addresses are distinct per persona", async () => {
  sigMain = (await retry(() => persona("signerProbe", { personaId: MAIN }))).json;
  const again = (await retry(() => persona("signerProbe", { personaId: MAIN }))).json;
  sigPub = (await retry(() => persona("signerProbe", { personaId: PUB2 }))).json;
  if (!/^[0-9a-f]{64}$/.test(sigMain.derivedPubHex ?? "")) throw new Error("MAIN signer: " + JSON.stringify(sigMain));
  if (sigMain.derivedPubHex !== again.derivedPubHex || sigMain.custodyAddress !== again.custodyAddress) throw new Error("derivation not deterministic");
  if (sigMain.derivedPubHex === sigPub.derivedPubHex) throw new Error("MAIN and PUB2 share a signer");
  if (sigMain.custodyAddress === sigPub.custodyAddress) throw new Error("MAIN and PUB2 share a custody address");
  if (recMain.signer.derivedPubHex !== sigMain.derivedPubHex || recPub.signer.derivedPubHex !== sigPub.derivedPubHex) throw new Error("recorded key differs from the derived key");
  if (recMain.custodyAddress !== sigMain.custodyAddress) throw new Error("recorded custody address differs");
});

// ---- 5. recovery ----
await check("5. RECOVERY: after total device loss, the minted persona's signer is gone (no seed, no key) and the 24-word phrase brings it and its custody address back bit for bit, with the persona ↔ fid map from the vault; the seeded persona's fixture-root keys are stable throughout", async () => {
  const got = await retry(() => api("POST", "/api/recovery", { action: "revealPhrase", acknowledged: true }));
  const phrase = got.json.phrase;
  if (!phrase || phrase.split(/\s+/).length !== 24) throw new Error("no phrase");
  if (!sigPub?.derivedPubHex) throw new Error("no PUB2 signer to compare against");
  await retry(() => api("POST", "/api/dev", { action: "simulateDeviceLoss" }));
  let lostKey;
  let rec;
  try {
    const lost = await persona("signerProbe", { personaId: PUB2 });
    lostKey = lost.status === 200 ? lost.json?.derivedPubHex : null;
  } finally {
    // recovery ALWAYS runs: a throw above must not leave the device wiped for every later check
    rec = await retry(() => api("POST", "/api/recovery", { action: "recover", phrase }));
  }
  if (lostKey && lostKey === sigPub.derivedPubHex) throw new Error("the minted persona's signer derived WITHOUT the seed after device loss");
  if (!rec.json.ok) throw new Error("recovery failed: " + rec.json.error);
  if (!(rec.json.recoveredPersonas ?? []).includes(PUB2)) throw new Error("the minted persona did not come back in the roster");
  const m = (await retry(() => persona("signerProbe", { personaId: MAIN }))).json;
  const p = (await retry(() => persona("signerProbe", { personaId: PUB2 }))).json;
  if (m.derivedPubHex !== sigMain.derivedPubHex || m.custodyAddress !== sigMain.custodyAddress) throw new Error("MAIN's signer did not come back: " + JSON.stringify(m));
  if (p.derivedPubHex !== sigPub.derivedPubHex || p.custodyAddress !== sigPub.custodyAddress) throw new Error("PUB2's signer did not come back");
  const v = await view();
  if (v.map[MAIN]?.fid !== recMain.fid || v.map[PUB2]?.fid !== recPub.fid) throw new Error("map after recovery: " + JSON.stringify(v.map));
});

// ---- 6. custody ----
await check("6. CUSTODY switches by config: under self-custody a fresh acquisition records a simulated KeyGateway add of the DERIVED key (no third-party signer); under neynar-managed a managed signer plus the derived key; the rig restores the default", async () => {
  await retry(() => persona("forget", { mode: "fixture" }));
  await retry(() => persona("setCustody", { kind: "self-custody" }));
  const r = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
  if (r.signer.kind !== "self-custody" || r.signer.simulated !== true || r.signer.registered !== true) throw new Error("self-custody record: " + JSON.stringify(r.signer));
  if (r.signer.derivedPubHex !== sigMain.derivedPubHex) throw new Error("self-custody registered a key that is not the derived one");
  await retry(() => persona("setCustody", { kind: null }));
  const v = await view();
  if (v.custody !== "neynar-managed") throw new Error("custody not restored: " + v.custody);
  const r2 = (await retry(() => persona("acquire", { personaId: PUB2 }))).json.record;
  if (r2.signer.kind !== "neynar-managed" || r2.signer.derivedRegistered !== false) throw new Error("neynar-managed record: " + JSON.stringify(r2.signer));
  recMain = r; recPub = r2;
});

// ---- 7. registrant linkage ----
await check("7. REGISTRANT LINKAGE (safety set): MAIN's and PUB2's fids share no registrant, funder or custody address that is not the sponsor; injected records sharing a user-attributable registrant are flagged by kind and fids, and a shared custody address is flagged too", async () => {
  const clean = (await retry(() => persona("registrantLinkage"))).json;
  if (clean.ok !== true || clean.findings.length !== 0 || clean.fids.length !== 2) throw new Error("clean pair flagged: " + JSON.stringify(clean));
  const evil = { personaId: "p_evil_probe", fid: 9_500_001, fname: "evil", origin: "fixture", custodyAddress: "0x" + "ab".repeat(20), signer: { kind: "self-custody", derivedPubHex: "cd".repeat(32), registered: true, simulated: true }, registrant: "0x" + "11".repeat(20), funder: "neynar-sponsor", createdAt: Date.now(), mode: "fixture" };
  const evil2 = { ...evil, personaId: "p_evil_probe_2", fid: 9_500_002, fname: "evil2", custodyAddress: recPub.custodyAddress, registrant: "0x" + "11".repeat(20) };
  await retry(() => persona("injectFidRecord", { record: evil }));
  await retry(() => persona("injectFidRecord", { record: evil2 }));
  const flagged = (await retry(() => persona("registrantLinkage"))).json;
  if (flagged.ok !== false) throw new Error("shared registrant not flagged: " + JSON.stringify(flagged));
  const kinds = flagged.findings.map((f) => f.kind);
  if (!kinds.includes("registrant") || !kinds.includes("custody")) throw new Error("findings: " + JSON.stringify(flagged.findings));
  const reg = flagged.findings.find((f) => f.kind === "registrant");
  if (!reg.fids.includes(9_500_001) || !reg.fids.includes(9_500_002)) throw new Error("registrant finding fids: " + JSON.stringify(reg));
  const cust = flagged.findings.find((f) => f.kind === "custody");
  if (!cust.fids.includes(recPub.fid) || !cust.fids.includes(9_500_002)) throw new Error("custody finding fids: " + JSON.stringify(cust));
});

// ---- 8. identity rule ----
await check("8. IDENTITY RULE (safety set): a third-party fid is refused, a foreign signer for an own fid is refused, a record whose origin is not this pass's path is refused, a persona named with another persona's fid is refused; MAIN by persona and PUB2 by fid are allowed", async () => {
  const third = await persona("identityProbe", { fid: 3 });
  if (third.status !== 403 || !/only ever write as fids it created itself/.test(third.json?.reason ?? "")) throw new Error("third-party fid allowed: " + JSON.stringify(third.json));
  const wrongSigner = await persona("identityProbe", { fid: recMain.fid, signerUuid: "someone-elses-signer" });
  if (wrongSigner.status !== 403 || !/signer/.test(wrongSigner.json?.reason ?? "")) throw new Error("foreign signer allowed: " + JSON.stringify(wrongSigner.json));
  await retry(() => persona("injectFidRecord", { record: { personaId: "p_foreign_origin", fid: 9_600_000, fname: "foreign", origin: "throwaway", custodyAddress: "0x" + "22".repeat(20), signer: { kind: "self-custody", derivedPubHex: "ef".repeat(32), registered: true, simulated: true }, registrant: "neynar-sponsor", funder: "neynar-sponsor", createdAt: Date.now(), mode: "fixture" } }));
  const foreignOrigin = await persona("identityProbe", { fid: 9_600_000 });
  if (foreignOrigin.status !== 403) throw new Error("foreign-origin record allowed: " + JSON.stringify(foreignOrigin.json));
  const byPersona = (await retry(() => persona("identityProbe", { personaId: MAIN }))).json;
  if (byPersona.allowed !== true || byPersona.fid !== recMain.fid || byPersona.personaId !== MAIN) throw new Error("MAIN by persona: " + JSON.stringify(byPersona));
  const byFid = (await retry(() => persona("identityProbe", { fid: recPub.fid }))).json;
  if (byFid.allowed !== true || byFid.personaId !== PUB2) throw new Error("PUB2 by fid: " + JSON.stringify(byFid));
  const mismatch = await persona("identityProbe", { personaId: MAIN, fid: recPub.fid });
  if (mismatch.status !== 403) throw new Error("MAIN named with PUB2's fid was allowed");
});

// ---- 9. the write door ----
await check("9. THE WRITE DOOR: a cast as MAIN is ledgered under MAIN's fid and a cast as PUB2 under PUB2's (two accounts on the sim network); the private persona's cast goes through the SHARED account, never under a persona's fid (v0, unchanged); in shared-fid mode no cast goes out under a persona's fid", async () => {
  const stamp = Date.now().toString(36);
  const a = (await retry(() => write({ action: "cast", personaId: MAIN, text: `fid1 main ${stamp} [layers-test fixture]` }))).json;
  const b = (await retry(() => write({ action: "cast", personaId: PUB2, text: `fid1 pub ${stamp} [layers-test fixture]` }))).json;
  if (a.fid !== recMain.fid || b.fid !== recPub.fid) throw new Error("casts not under the personas' fids: " + JSON.stringify({ a: a.fid, b: b.fid }));
  const ledger = (await retry(() => api("GET", "/api/fc/write"))).json.entries;
  const la = ledger.find((e) => e.castHash === a.hash);
  const lb = ledger.find((e) => e.castHash === b.hash);
  if (!la || !lb || la.fid !== recMain.fid || lb.fid !== recPub.fid) throw new Error("ledger fids: " + JSON.stringify({ la, lb }).slice(0, 300));
  const priv = (await retry(() => write({ action: "cast", personaId: ALT, text: `fid1 private ${stamp} [layers-test fixture]` }))).json;
  if (priv.fid === recMain.fid || priv.fid === recPub.fid) throw new Error("the private persona's cast went out under a persona's fid: " + priv.fid);
  const v = await view();
  if (v.map[ALT]) throw new Error("the private persona acquired a fid by casting");
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    const c = (await retry(() => write({ action: "cast", personaId: MAIN, text: `fid1 shared ${stamp} [layers-test fixture]` }))).json;
    if (c.fid === recMain.fid || c.fid === recPub.fid) throw new Error("shared-fid mode posted under a persona's fid: " + c.fid);
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
});

// ---- 10. what the validator learns + the reset contract ----
await check("10. WHAT THE VALIDATOR LEARNS: NO plain persona → fid map at all (the app's map comes off the sealed record); the record namespace is ciphertext (no custody address, signer or registrant in the clear anywhere in its state); resetSeed empties the map and the next fixture acquisition starts over at the same fid", async () => {
  // MULTI-FID Gate 5 (D-FID-5-MAP-SEALED, attack-fid-1 #11 / -2 #1 / -3 #16): NO plain persona → fid map on the validator —
  // one device-signed document listing every account of a root was the persona → root grouping migration 006 removed
  const plain = (await vapi("/state/personaFidMap")).json;
  const entries = plain?.entries ?? plain?.state ?? plain;
  if (Object.keys(entries ?? {}).length) throw new Error("a plain persona→fid map exists on the validator: " + JSON.stringify(plain).slice(0, 300));
  const v0 = await view();
  if (v0.map[MAIN]?.fid !== recMain.fid || v0.map[PUB2]?.fid !== recPub.fid) throw new Error("the app's own (sealed-record) map: " + JSON.stringify(v0.map));
  const sealed = (await vapi("/state/personaFids")).json;
  const sealedEntries = sealed?.entries ?? sealed?.state ?? sealed;
  const rec = sealedEntries?._;
  if (!rec || typeof rec.ct !== "string") throw new Error("record namespace not ciphertext: " + JSON.stringify(sealed).slice(0, 200));
  const whole = JSON.stringify((await vapi("/state")).json).toLowerCase();
  for (const needle of [recMain.custodyAddress.toLowerCase(), recPub.custodyAddress.toLowerCase(), "sim-signer-", "neynar-sponsor"]) {
    if (whole.includes(needle)) throw new Error("validator state carries the record in the clear: " + needle);
  }
  await reset();
  const v = await view();
  if (Object.keys(v.map).length !== 0) throw new Error("map survived reset: " + JSON.stringify(v.map));
  const r = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
  if (r.fid !== 9_000_000) throw new Error("fixture counter did not reset: " + r.fid);
  await reset();
});

const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 1 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
