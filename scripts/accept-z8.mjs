// ZK PASS 2 — GATE 3: fork continuity as a PROOF, revocation via epoch
// re-issuance, attestation scaffolding. FIXTURE-ONLY (ZK_DEV_HOOKS=true on
// both processes; validator under the supervisor; 3 s prefetch cadence).
//
//   1. the scope registry has the two new entries (per-persona, linkage
//      argued) and the validator's duplicate agrees; CLAIM_KINDS agree
//   2. FORK CONTINUITY end to end: the fork route mints a commitment
//      sha256(old|new|nonce), hands the nonce ONLY to a carried holder,
//      requests the proof; the tick proves it; the validator records the
//      claim under the commitment; the new persona's tier is the PROVEN
//      tier — carried through the proof, never a root read
//   3. THE BINDING: a tampered forkCommit is refused by the verifier; a
//      tier proof carrying a forkCommit is refused
//   4. REVOCATION: signed, append-only, effective next epoch; the old
//      commitment cannot re-register; re-issuance moves the device to
//      identity index 1 and registers a NEW commitment that proves again
//   5. ATTESTATION (scaffolding): the mock issuer attests; the attest tree
//      appears next epoch; a persona proves it; expiry drops the leaf and
//      the proof stops
//   6. LEAKS: the nonce never reaches the validator in the clear; the
//      validator's fork record holds the commitment only
//   7. DOCS: SECURITY-POSTURE §11
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";

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
async function vapi(path) { const r = await fetch(VBASE + path); return { status: r.status, json: await r.json().catch(() => null) }; }
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + JSON.stringify(r.json).slice(0, 300)); } catch (e) { last = e; } await sleep(400 * (i + 1)); }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const strip = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");

console.log("\nZK Pass 2 Gate 3 — fork continuity as a proof, revocation via epoch re-issuance, attestation scaffolding");

// ---- setup: a fresh fixture universe with a cohort, our commitment a leaf ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await retry(() => zk("resetZk"));
// the zk binding is a runtime switch (the env default is the mock binding)
await retry(() => zk("setRepImpl", { impl: "zk" }));
// Attestation pass Gate 1: the mock issuer is honoured only when the rig says so
await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
await retry(() => zk("seedDecoys", { count: 60 }));
await retry(() => zk("register"));
await retry(() => zk("advanceEpoch"));
await retry(() => zk("prefetchNow"));
await sleep(300);
const TREE = (await retry(() => zk("gateStatus"))).json.tree;
const T = Number(TREE.slice(5));

// ---- 1. registry ----
await check("1. REGISTRY: fork-continuity and attestation are registered per-persona scopes with linkage arguments; the validator's duplicate names the same features; CLAIM_KINDS agree on both sides", async () => {
  const scopes = readFileSync("lib/zk/scopes.ts", "utf8");
  for (const id of ["fork-continuity", "attestation"]) {
    const m = new RegExp(`id: "${id}",\\s*feature: "${id}",\\s*onePerHuman: false,\\s*linkage:`).test(scopes);
    if (!m) throw new Error(`scopes.ts lacks a per-persona entry "${id}" with a linkage argument`);
  }
  const vz = readFileSync("validator/zk.js", "utf8");
  if (!/"fork-continuity": \{ feature: "fork-continuity", onePerHuman: false \}/.test(vz) || !/attestation: \{ feature: "attestation", onePerHuman: false \}/.test(vz)) throw new Error("validator SCOPE_FOR_CLAIM does not duplicate the two entries");
  const client = /CLAIM_KINDS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(readFileSync("lib/zk/transport/types.ts", "utf8"))?.[1];
  const server = /const CLAIM_KINDS = \[([^\]]*)\]/.exec(vz)?.[1];
  const norm = (s) => (s || "").replace(/\s|"/g, "");
  if (!client || norm(client) !== norm(server)) throw new Error(`CLAIM_KINDS differ: client [${client}] validator [${server}]`);
});

// ---- 2. fork continuity ----
let NEW = null, forkCommit = null, forkNonce = null, holder = null, source = null;
await check("2. FORK CONTINUITY: the fork mints a commitment over old|new|nonce, discloses the nonce only to a carried holder, and the NEW persona's tier is the tier the fork-continuity proof carried — 0 before, T after, recorded under the commitment", async () => {
  // a source persona with at least one grant holder (the disclosure half needs one)
  for (const cand of [ALT, MAIN, "brothandbones", "0xledgerline"]) {
    const h = (await api("GET", `/api/identity/fork?personaId=${cand}`)).json;
    if (h?.holders?.length) { source = h.personaId; holder = h.holders[0].audienceMember; break; }
  }
  if (!source) { source = ALT; holder = null; }
  const carry = holder ? [holder] : [];
  const r = await retry(() => api("POST", "/api/identity/fork", { fromPersona: source, carry, newName: "Z8 Continued", newHandle: "z8c_" + stamp }));
  NEW = r.json.newPersona;
  forkCommit = r.json.continuity?.forkCommit;
  if (!NEW || !/^[0-9a-f]{64}$/.test(forkCommit || "")) throw new Error("fork response lacks the continuity commitment: " + JSON.stringify(r.json).slice(0, 300));
  if (r.json.continuity.proofRequested !== true) throw new Error("the fork did not request the continuity proof under zk");
  if ("forkNonce" in r.json || /forkNonce/.test(JSON.stringify(r.json))) throw new Error("the fork response leaks the nonce");
  // disclosure: only the carried holder is handed the nonce
  if (holder) {
    const res = (await retry(() => api("GET", `/api/identity/fork?resolve=${source}&viewerPersonaId=${holder}`))).json;
    if (res.moved !== NEW) throw new Error("carried holder cannot resolve the forward pointer: " + JSON.stringify(res));
    forkNonce = res.continuity?.forkNonce;
    if (!/^[0-9a-f]{32}$/.test(forkNonce || "") || res.continuity.forkCommit !== forkCommit) throw new Error("carried holder was not handed the continuity (nonce + commitment): " + JSON.stringify(res.continuity));
    if (sha(["layers-fork-commit/1", source, NEW, forkNonce].join("|")) !== forkCommit) throw new Error("the commitment does not open to sha256(old|new|nonce)");
  }
  const other = (await api("GET", `/api/identity/fork?resolve=${source}&viewerPersonaId=persona_acc_food_1`)).json;
  if (other?.moved || other?.continuity) throw new Error("a non-holder learned the move or the continuity: " + JSON.stringify(other));
  // the tier carries THROUGH the proof: the tick proves the fork claim, the drain submits it
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
  const claim = (await retry(() => zk("forkClaim", { personaId: NEW, forkCommit }))).json;
  if (claim.verified !== true || claim.tier !== T || claim.tree !== TREE) throw new Error("fork claim not recorded as verified at the gate tier: " + JSON.stringify(claim) + " drain=" + JSON.stringify(d).slice(0, 200));
  const tier = (await retry(() => api("GET", `/api/tier?personaId=${NEW}`))).json;
  if (tier.tier !== T || tier.proven !== true) throw new Error("the new persona's tier is not the PROVEN tier: " + JSON.stringify(tier));
  const attempts = (await retry(() => zk("gateStatus"))).json.attempts;
  if (!attempts.some((a) => a.personaId === NEW && a.claimKind === "fork-continuity" && a.queuedId)) throw new Error("no fork-continuity proof attempt recorded for the new persona");
  const wrong = (await retry(() => zk("forkClaim", { personaId: NEW, forkCommit: "0".repeat(64) }))).json;
  if (wrong.verified !== false) throw new Error("a wrong commitment verifies");
});

// ---- 3. the binding ----
await check("3. BINDING: an envelope whose forkCommit was changed after proving is refused as a non-canonical derivation; a tier-membership envelope carrying a forkCommit is refused; the untampered fork envelope is accepted", async () => {
  // proofs are made only for THIS root's personas: MAIN for the fork claim
  const persona = MAIN;
  const commit = sha("z8-binding-" + stamp);
  const out = (await zk("prove", { claimKind: "fork-continuity", tree: TREE, personaId: persona, gateId: "foryou", forkCommit: commit })).json;
  if (!out.ok) throw new Error("prove refused: " + JSON.stringify(out).slice(0, 300));
  const tampered = JSON.parse(JSON.stringify(out.envelope));
  tampered.publicInputs.forkCommit = commit.slice(0, 63) + (commit.endsWith("a") ? "b" : "a");
  const t = (await zk("submit", { envelope: tampered })).json;
  if (t.status !== 400 || !/canonical derivation|forkCommit/.test(JSON.stringify(t.response))) throw new Error("tampered forkCommit was not refused as a binding failure: " + JSON.stringify(t));
  const plain = (await zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: ALT, gateId: "foryou" })).json;
  if (!plain.ok) throw new Error("tier prove refused: " + JSON.stringify(plain).slice(0, 200));
  const withFork = JSON.parse(JSON.stringify(plain.envelope));
  withFork.publicInputs.forkCommit = commit;
  const w = (await zk("submit", { envelope: withFork })).json;
  if (w.status !== 400) throw new Error("a tier envelope carrying a forkCommit was accepted: " + JSON.stringify(w));
  const good = (await zk("submit", { envelope: out.envelope })).json;
  if (good.status !== 200 || good.response?.accepted !== true) throw new Error("the untampered fork envelope was refused: " + JSON.stringify(good));
  const claim = (await retry(() => zk("forkClaim", { personaId: persona, forkCommit: commit }))).json;
  if (claim.verified !== true) throw new Error("the accepted fork claim is not recorded");
});

// ---- 4. revocation via epoch re-issuance ----
let oldCommitment = null;
await check("4. REVOCATION: signed and append-only, effective next epoch — this epoch still proves, next epoch the old commitment is no leaf and cannot re-register; re-issuance moves the device to identity index 1 and the NEW commitment proves again", async () => {
  const s0 = await status();
  oldCommitment = s0.commitment;
  if (s0.identityIndex !== 0) throw new Error("identity index is not 0 at the start: " + s0.identityIndex);
  const epoch = s0.epoch;
  const r = (await retry(() => zk("revoke"))).json;
  if (r.ok !== true || r.revokedFromEpoch !== epoch + 1) throw new Error("revoke: " + JSON.stringify(r));
  const s1 = await status();
  if (s1.registration.revokedFromEpoch !== epoch + 1 || s1.registration.activeNow !== true) throw new Error("status after revoke: " + JSON.stringify(s1.registration));
  // still this epoch: the frozen tree keeps the leaf
  const m0 = (await vapi(`/zk/members?mode=fixture&tree=valid`)).json;
  if (!m0.members.includes(oldCommitment)) throw new Error("the revoked commitment vanished from the FROZEN epoch's tree");
  const again = (await zk("revoke")).json;
  if (again.existing !== true || again.revokedFromEpoch !== epoch + 1) throw new Error("revocation is not append-only/idempotent: " + JSON.stringify(again));
  const reg = (await zk("register")).json;
  if (reg.ok !== false || reg.status !== 409) throw new Error("a revoked commitment could re-register: " + JSON.stringify(reg));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  const m1 = (await vapi(`/zk/members?mode=fixture&tree=valid`)).json;
  if (m1.members.includes(oldCommitment)) throw new Error("the revoked commitment is still a leaf after the epoch advanced");
  const s2 = await status();
  if (s2.registration.activeNow !== false) throw new Error("status still active after the revocation epoch: " + JSON.stringify(s2.registration));
  const refused = (await zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: ALT, gateId: "foryou" })).json;
  if (refused.ok !== false || refused.stage !== "membership") throw new Error("a revoked root still proves: " + JSON.stringify(refused).slice(0, 200));
  // re-issuance
  const re = (await zk("reissue")).json;
  if (re.index !== 1 || !re.commitment || re.commitment === oldCommitment || re.registration?.ok !== true || re.pending !== true) throw new Error("reissue: " + JSON.stringify(re).slice(0, 300));
  // PENDING until the activation epoch (attack-z2-2 #4): the device still reports — and proves with — the old branch
  const s3 = await status();
  if (s3.identityIndex !== 0 || s3.commitment !== oldCommitment || !s3.pendingIdentity || s3.pendingIdentity.index !== 1 || s3.pendingIdentity.activeFromEpoch !== re.registration.activeFromEpoch) throw new Error("status after reissue (should be pending): " + JSON.stringify({ index: s3.identityIndex, pending: s3.pendingIdentity, registration: re.registration }));
  const oldReg = (await vapi(`/zk/registration?mode=fixture&commitment=${oldCommitment}`)).json;
  if (oldReg.registered !== true || oldReg.revokedFromEpoch !== epoch + 1) throw new Error("the old registration lost its revocation record: " + JSON.stringify(oldReg));
  await retry(() => zk("advanceEpoch"));
  // the tick that sees the activation epoch promotes the pending branch. VERIFY (wave 2, harness): prefetchNow answers
  // 200 with tick.ok === false when the tick could not reach the validator (seen once in the wave-2 sweep and on a
  // long-running pair right after accept-z7's validator kill: "zk validator unreachable (/zk/validator-key): fetch
  // failed"), and a FAILED tick promotes nothing by design (it never saw the epoch). Poll for a tick that COMPLETED, as
  // the ops rule says (retry on content, not on status); the assertion below is unchanged.
  let tk4 = null;
  for (let i = 0; i < 4 && tk4?.ok !== true; i++) {
    if (i) await sleep(1500);
    tk4 = (await retry(() => zk("prefetchNow"))).json?.tick ?? null;
  }
  const s4 = await status();
  if (s4.identityIndex !== 1 || s4.commitment !== re.commitment || s4.pendingIdentity !== null || s4.registration.registered !== true || s4.registration.revokedFromEpoch !== null) throw new Error("status after the activation epoch: " + JSON.stringify({ index: s4.identityIndex, commitment: s4.commitment, pending: s4.pendingIdentity, registration: s4.registration, epoch: s4.epoch, tick: tk4 && { ok: tk4.ok, error: tk4.error, ms: Math.round(tk4.ms) } }));
  const probe = (await retry(() => zk("probe"))).json;
  if (probe.commitment !== re.commitment || probe.derivedTwiceIdentical !== true) throw new Error("the re-issued identity is not deterministic");
  const m2 = (await vapi(`/zk/members?mode=fixture&tree=valid`)).json;
  if (!m2.members.includes(re.commitment) || m2.members.includes(oldCommitment)) throw new Error("after re-issuance the new commitment is not the leaf (or the old one is)");
  const proves = (await zk("prove", { claimKind: "tier-membership", tree: TREE, personaId: MAIN, gateId: "foryou" })).json;
  if (proves.ok !== true) throw new Error("the re-issued identity cannot prove: " + JSON.stringify(proves).slice(0, 200));
  // THE RECOVERY SCAN (attack-z2-3 #4): walking the branches from 0 finds index 0 revoked and index 1 active
  const scan = (await retry(() => zk("recoverIdentityIndex"))).json;
  if (scan.index !== 1 || scan.found !== "active") throw new Error("recovery scan: " + JSON.stringify(scan));
  const s5 = await status();
  if (s5.identityIndex !== 1 || s5.commitment !== re.commitment) throw new Error("the scan did not land on the active branch");
});

// ---- 5. attestation scaffolding ----
await check("5. ATTESTATION: the mock issuer attests the commitment (and the decoy cohort) with an expiry; the attest:test.mock-issuer/any tree is issued next epoch and clears the floor; a persona proves it and is 'attested'; expiry drops the leaf, the proof stops and the mark lapses", async () => {
  const s0 = await status();
  const E = s0.epoch;
  const a = (await retry(() => zk("attest", { issuer: "test.mock-issuer", includeDecoys: true }))).json.response;
  if (a?.ok !== true || a.mock !== true || a.activeFromEpoch !== E + 1 || a.expiresEpoch !== E + 2 || !(a.decoysAttested >= 50)) throw new Error("attest: " + JSON.stringify(a));
  const list = (await retry(() => zk("attestations"))).json;
  const mine = list.attestations?.find((x) => x.issuer === "test.mock-issuer" && x.bucket === "any");
  if (!mine || mine.activeNow !== false || mine.expiresEpoch !== E + 2) throw new Error("attestations read: " + JSON.stringify(list));
  const before = (await vapi(`/zk/trees?mode=fixture`)).json.trees.find((t) => t.tree === "attest:test.mock-issuer/any");
  if (before && before.size > 0) throw new Error("the attest tree already has leaves in the issuing epoch (not batched)");
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  const tree = (await vapi(`/zk/trees?mode=fixture`)).json.trees.find((t) => t.tree === "attest:test.mock-issuer/any");
  if (!tree || tree.size < 51) throw new Error("attest:mock tree not issued with the cohort next epoch: " + JSON.stringify(tree));
  await retry(() => zk("requestAttestation", { personaId: MAIN, issuer: "test.mock-issuer", bucket: "any" }));
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
  const at = (await retry(() => zk("attested", { personaId: MAIN, issuer: "test.mock-issuer" }))).json;
  if (at.attested !== true) throw new Error("MAIN is not attested after proving: " + JSON.stringify(at) + " drain=" + JSON.stringify(d).slice(0, 200));
  const attempts = (await retry(() => zk("gateStatus"))).json.attempts;
  if (!attempts.some((x) => x.personaId === MAIN && x.claimKind === "attestation" && x.queuedId)) throw new Error("no attestation proof attempt recorded");
  // expiry: E+2 drops the leaf; the mark (with its one-epoch grace) lapses at E+3
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  const expired = (await vapi(`/zk/trees?mode=fixture`)).json.trees.find((t) => t.tree === "attest:test.mock-issuer/any");
  if (!expired || expired.size !== 0) throw new Error("the attest tree still has leaves after expiry: " + JSON.stringify(expired));
  const refused = (await zk("prove", { claimKind: "attestation", tree: "attest:test.mock-issuer/any", personaId: ALT, gateId: "attest:test.mock-issuer/any", issuer: "test.mock-issuer", bucket: "any" })).json;
  // an emptied attest tree is refused at the COHORT stage (0 < floor) before membership is even asked — either refusal is the design working
  if (refused.ok !== false || !["cohort", "membership"].includes(refused.stage)) throw new Error("an expired attestation did not fail at cohort/membership: " + JSON.stringify(refused).slice(0, 200));
  const lapsed = (await retry(() => zk("attested", { personaId: MAIN, issuer: "test.mock-issuer" }))).json;
  if (lapsed.attested !== false) throw new Error("the attested mark did not lapse after expiry: " + JSON.stringify(lapsed));
});

// ---- 6. leaks ----
await check("6. LEAKS: the fork nonce and the old→new pairing never reach the validator in the clear (state is sealed; the fork record holds the commitment only; the validator log has neither); the validator code names no old persona", async () => {
  const state = JSON.stringify((await vapi("/state")).json ?? {});
  if (forkNonce && state.includes(forkNonce)) throw new Error("the fork nonce is stored on the validator in the clear");
  if (forkCommit && NEW && source && new RegExp(`${source}[^\\n]{0,200}${NEW}|${NEW}[^\\n]{0,200}${source}`).test(state)) throw new Error("old→new pairing visible in validator state");
  const vz = strip(readFileSync("validator/zk.js", "utf8"));
  if (/oldPersona|fromPersona|forkNonce/.test(vz)) throw new Error("validator/zk.js references the old persona or the nonce");
  const logPath = process.env.TEMP ? process.env.TEMP + "/layers-validator.log" : null;
  if (logPath && existsSync(logPath)) {
    const log = readFileSync(logPath, "utf8");
    if ((forkNonce && log.includes(forkNonce)) || (forkCommit && log.includes(forkCommit))) throw new Error("the validator log carries the nonce or the commitment");
  }
  const claim = (await retry(() => zk("forkClaim", { personaId: NEW, forkCommit }))).json;
  if (JSON.stringify(claim).includes(source)) throw new Error("the fork-claim read names the old persona");
});

// ---- 7. docs ----
await check("7. DOCS: SECURITY-POSTURE.md §11 states fork continuity, revocation via epoch re-issuance, the attestation scaffolding and that the issuer is a decision for the morning", async () => {
  const p = readFileSync("SECURITY-POSTURE.md", "utf8");
  for (const needle of ["## 11.", "fork continuity", "revocation via epoch re-issuance", "MOCK issuer", "notes/runbooks/MORNING.md"]) {
    if (!p.includes(needle)) throw new Error("SECURITY-POSTURE.md lacks: " + needle);
  }
});

await retry(() => zk("setRepImpl", { impl: null }));
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${passed}/${results.length} ZK Pass 2 Gate 3 checks passed${failed.length ? ", " + failed.length + " FAILED" : ""}`);
process.exit(failed.length ? 1 : 0);
