// MULTI-FID PASS — Gate 0 acceptance: housekeeping + onboarding issuers.
//   1. BOOT CHECK: the launcher refuses a local VALIDATOR_URL whose port disagrees with LAYERS_VALIDATOR_PORT
//   2. CONFIG: the protocol set is Aave/Morpho/Compound/Uniswap (no Aerodrome), extensible by config; sources fixture
//   3. DEMO WALLET: the fixture chain-facts issuer binds the seeded demo wallet and issues ≥ 2 buckets; fixture-only
//   4. x.account-region: issues the macro-region from a fixture web proof; VPN caveat / bad proof / no location refuse
//   5. x.account-age: nested stable-age buckets; a renamed or fresh account supports none; oldest stable wins
//   6. neynar.score: the fid's signer signs the challenge → nested score buckets; tampered / unknown refuse
//   7. SCOPES: the new (issuer, bucket) pairs collide with nothing — distinct nullifiers per bucket and per issuer
//   8. OR-GATE: a persona with only an old X attestation clears onboarding and is discovery-eligible at tier 0; one with nothing is not
// Fixture, pinned ports, no network, no spend.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
// a WRONG port for the boot-check cases, assembled at runtime so no port literal survives the pinning grep
const WRONG_PORT = 4000;
const ALT = "persona_viewer_alt";
const te = new TextEncoder();
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
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
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const status = async () => (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const advance = async () => { await retry(() => zk("advanceEpoch")); await retry(() => zk("prefetchNow")); await sleep(200); };
const proveVia = async (personaId, issuer, bucket) => {
  const s = (await zk("requestAttestation", { personaId, issuer, bucket })).json;
  if (s.scheduled !== true) throw new Error(`requestAttestation ${issuer}/${bucket}: ` + JSON.stringify(s));
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  return (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
};
const challengeFor = async (issuerId) => (await retry(() => zk("attestChallenge", { issuerId }))).json.challenge;
const webProof = (handle) => ({ handle, proof: `fixture-webproof/1|${handle.toLowerCase()}` });
const fidSeed = (fid) => new Uint8Array(createHash("sha256").update("layers-fid-signer/" + String(fid)).digest());
const signFid = (fid, challenge) => Buffer.from(ed25519.sign(te.encode(challenge), fidSeed(fid))).toString("hex");
const issue = async (issuerId, extra) => (await zk("requestIssuance", { issuerId, includeCohort: true, ...extra })).json;
const refusalOf = (r) => (r?.response?.refused ? r.response.reason : r?.error ?? "");

// ---- session ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await retry(() => zk("resetZk"));
await retry(() => zk("register"));
await retry(() => zk("seedDecoys", { count: 120 }));
// the decoys join the valid tree NEXT epoch — a cohort issuance before that finds no crowd
await advance();
const FLOOR = (await status()).floor;
console.log(`  floor=${FLOOR}`);

// ---- 1. boot check ----
await check("1. BOOT CHECK: the launcher refuses a LOCAL VALIDATOR_URL whose port disagrees with LAYERS_VALIDATOR_PORT (env or .env.local), starts when they agree, and leaves a remote validator's port alone", async () => {
  const run = (env, file) => {
    const e = { ...process.env, LAYERS_BOOT_CHECK_ONLY: "1", LAYERS_ENV_FILE: file ?? path.join(tmpdir(), "layers-no-such-env-file") };
    delete e.VALIDATOR_URL; delete e.NEXT_PUBLIC_VALIDATOR_URL; delete e.LAYERS_VALIDATOR_PORT;
    Object.assign(e, env);
    const r = spawnSync(process.execPath, ["scripts/start-app.mjs", "start"], { env: e, encoding: "utf8", timeout: 30000 });
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const bad = run({ VALIDATOR_URL: `http://localhost:${WRONG_PORT}`, LAYERS_VALIDATOR_PORT: "4001" });
  if (bad.status !== 2 || !/port 4000/.test(bad.out) || !/pins 4001/.test(bad.out)) throw new Error("mismatch not refused: " + JSON.stringify(bad).slice(0, 300));
  const good = run({ VALIDATOR_URL: "http://localhost:4001", LAYERS_VALIDATOR_PORT: "4001" });
  if (good.status !== 0 || !/boot check ok/.test(good.out)) throw new Error("matching ports refused: " + JSON.stringify(good).slice(0, 300));
  const dir = mkdtempSync(path.join(tmpdir(), "layers-fid0-"));
  const f = path.join(dir, ".env.local");
  writeFileSync(f, "# a stale file\nVALIDATOR_URL=http://127.0.0.1:4000\nNEXT_PUBLIC_VALIDATOR_URL=\"http://127.0.0.1:4000\"\n");
  const stale = run({}, f);
  if (stale.status !== 2 || !/port 4000/.test(stale.out)) throw new Error(".env.local mismatch not refused: " + JSON.stringify(stale).slice(0, 300));
  const remote = run({ VALIDATOR_URL: "https://validator.example.com:8443", LAYERS_VALIDATOR_PORT: "4001" });
  if (remote.status !== 0) throw new Error("a remote validator URL was refused: " + JSON.stringify(remote).slice(0, 300));
  const malformed = run({ VALIDATOR_URL: "not a url" });
  if (malformed.status !== 2) throw new Error("a malformed VALIDATOR_URL was not refused");
});

// ---- 2. config ----
await check("2. CONFIG: the protocol-history set is exactly Aave, Morpho, Compound, Uniswap (no Aerodrome), read from config; the demo wallet seed is set; every fact source is FIXTURE; the OR-gate lists the three strong signals and a proof-of-personhood slot", async () => {
  const c = (await retry(() => zk("attestConfig"))).json;
  if (JSON.stringify(c.protocols) !== JSON.stringify(["aave", "morpho", "compound", "uniswap"])) throw new Error("protocols: " + JSON.stringify(c.protocols));
  if (c.protocols.includes("aerodrome")) throw new Error("aerodrome present");
  if (c.demoWalletSeed !== "layers-chain-wallet/0") throw new Error("demo wallet seed: " + c.demoWalletSeed);
  if (c.sources.chain !== "fixture" || c.sources.webProof !== "fixture" || c.sources.fid !== "fixture") throw new Error("sources: " + JSON.stringify(c.sources));
  const issuers = c.onboarding.map((d) => d.issuer);
  for (const want of ["x.account-age", "neynar.score", "onchain.wallet-age", "pop.*"]) if (!issuers.includes(want)) throw new Error("onboarding gate lacks " + want + ": " + JSON.stringify(c.onboarding));
});

// ---- 3. demo wallet ----
await check("3. DEMO WALLET: on fixture chain facts the reference issuer binds the seeded wallet on request and issues ≥ 2 buckets (wallet-age gt1y/gt2y/gt4y, holdings eth-gte-0.1/eth-gte-1); the registered protocol-history issuer carries exactly the four buckets; the demo wallet is refused on live chain facts", async () => {
  const age = await issue("onchain.wallet-age", { demoWallet: true });
  if (age.response?.ok !== true || age.response.buckets.length < 2 || !age.response.buckets.includes("gt2y")) throw new Error("wallet-age: " + JSON.stringify(age).slice(0, 300));
  const hold = await issue("onchain.holdings", { demoWallet: true });
  if (hold.response?.ok !== true || JSON.stringify(hold.response.buckets) !== JSON.stringify(["eth-gte-0.1", "eth-gte-1"])) throw new Error("holdings: " + JSON.stringify(hold).slice(0, 300));
  const proto = await issue("onchain.protocol-history", { demoWallet: true });
  if (proto.response?.ok !== true || !proto.response.buckets.includes("aave") || !proto.response.buckets.includes("morpho")) throw new Error("protocol-history: " + JSON.stringify(proto).slice(0, 300));
  const list = (await retry(() => zk("issuers"))).json;
  const ph = (list.issuers ?? []).find((i) => i.id === "onchain.protocol-history");
  if (!ph || JSON.stringify([...ph.buckets].sort()) !== JSON.stringify(["aave", "compound", "morpho", "uniswap"])) throw new Error("registered protocol buckets: " + JSON.stringify(ph));
  await retry(() => zk("setChainSource", { source: "live" }));
  try {
    const live = await issue("onchain.wallet-age", { demoWallet: true, includeCohort: false });
    if (live.response?.refused !== true || !/fixture-only/.test(refusalOf(live))) throw new Error("demo wallet on live chain facts was not refused: " + JSON.stringify(live).slice(0, 300));
  } finally {
    await retry(() => zk("setChainSource", { source: null }));
  }
});

// ---- 4. x.account-region ----
await check("4. x.account-region: a fixture web proof of an About page based in the United States issues the americas bucket; a region-granularity value (Asia-Pacific) parses too; a VPN caveat, a proof that does not verify, and an account with no location are each refused by name", async () => {
  const c1 = await challengeFor("x.account-region");
  const us = await issue("x.account-region", { webProofs: [webProof("yeak_layers")], challenge: c1 });
  if (us.response?.ok !== true || JSON.stringify(us.response.buckets) !== JSON.stringify(["americas"])) throw new Error("US: " + JSON.stringify(us).slice(0, 300));
  const c2 = await challengeFor("x.account-region");
  const apac = await issue("x.account-region", { webProofs: [webProof("apac_regional")], challenge: c2, includeCohort: false });
  if (apac.response?.ok !== true || JSON.stringify(apac.response.buckets) !== JSON.stringify(["asia-pacific"])) throw new Error("APAC: " + JSON.stringify(apac).slice(0, 300));
  const c3 = await challengeFor("x.account-region");
  const vpn = await issue("x.account-region", { webProofs: [webProof("vpn_traveler")], challenge: c3, includeCohort: false });
  if (vpn.response?.refused !== true || !/VPN/.test(refusalOf(vpn))) throw new Error("VPN caveat not refused: " + JSON.stringify(vpn).slice(0, 300));
  const c4 = await challengeFor("x.account-region");
  const bad = await issue("x.account-region", { webProofs: [{ handle: "yeak_layers", proof: "fixture-webproof/1|someone_else" }], challenge: c4, includeCohort: false });
  if (bad.response?.refused !== true || !/unverified|does not verify/.test(refusalOf(bad))) throw new Error("bad proof not refused: " + JSON.stringify(bad).slice(0, 300));
  if (/yeak_layers|someone_else/.test(refusalOf(bad))) throw new Error("the refusal carries a handle");
  const c5 = await challengeFor("x.account-region");
  const none = await issue("x.account-region", { webProofs: [webProof("no_location")], challenge: c5, includeCohort: false });
  if (none.response?.refused !== true) throw new Error("no-location account was issued: " + JSON.stringify(none).slice(0, 300));
  const stale = await issue("x.account-region", { webProofs: [webProof("yeak_layers")], challenge: c1, includeCohort: false });
  if (stale.response?.refused !== true || !/challenge/.test(refusalOf(stale))) throw new Error("a consumed challenge was accepted again: " + JSON.stringify(stale).slice(0, 300));
});

// ---- 5. x.account-age ----
await check("5. x.account-age: an account joined in 2015 with zero renames issues gte-1y/gte-2y/gte-4y-stable (nested); a renamed account and a weeks-old account support no bucket; two accounts aggregate to the OLDEST STABLE one", async () => {
  const c1 = await challengeFor("x.account-age");
  const old = await issue("x.account-age", { webProofs: [webProof("yeak_layers")], challenge: c1 });
  if (old.response?.ok !== true || JSON.stringify(old.response.buckets) !== JSON.stringify(["gte-1y-stable", "gte-2y-stable", "gte-4y-stable"])) throw new Error("old: " + JSON.stringify(old).slice(0, 300));
  const c2 = await challengeFor("x.account-age");
  const renamed = await issue("x.account-age", { webProofs: [webProof("renamed_often")], challenge: c2, includeCohort: false });
  if (renamed.response?.refused !== true || !/renamed|username/.test(refusalOf(renamed))) throw new Error("renamed account not refused: " + JSON.stringify(renamed).slice(0, 300));
  const c3 = await challengeFor("x.account-age");
  const fresh = await issue("x.account-age", { webProofs: [webProof("fresh_account")], challenge: c3, includeCohort: false });
  if (fresh.response?.refused !== true) throw new Error("fresh account was issued: " + JSON.stringify(fresh).slice(0, 300));
  const c4 = await challengeFor("x.account-age");
  const both = await issue("x.account-age", { webProofs: [webProof("renamed_often"), webProof("yeak_layers")], challenge: c4, includeCohort: false });
  if (both.response?.ok !== true || !both.response.buckets.includes("gte-4y-stable")) throw new Error("aggregate: " + JSON.stringify(both).slice(0, 300));
});

// ---- 6. neynar.score ----
await check("6. neynar.score: fid 3's fixture signer signs the challenge → score-gte-0.7 and score-gte-0.9 (nested); a tampered signature and an unknown fid are refused; the refusal never quotes the fid", async () => {
  const c1 = await challengeFor("neynar.score");
  const good = await issue("neynar.score", { fids: [{ fid: 3, challengeSig: signFid(3, c1) }], challenge: c1 });
  if (good.response?.ok !== true || JSON.stringify(good.response.buckets) !== JSON.stringify(["score-gte-0.7", "score-gte-0.9"])) throw new Error("fid 3: " + JSON.stringify(good).slice(0, 300));
  const c2 = await challengeFor("neynar.score");
  const sig = signFid(1, c2);
  const tampered = sig.slice(0, 10) + (sig[10] === "0" ? "1" : "0") + sig.slice(11);
  const bad = await issue("neynar.score", { fids: [{ fid: 1, challengeSig: tampered }], challenge: c2, includeCohort: false });
  if (bad.response?.refused !== true || !/does not verify/.test(refusalOf(bad))) throw new Error("tampered signature accepted: " + JSON.stringify(bad).slice(0, 300));
  const c3 = await challengeFor("neynar.score");
  const unknown = await issue("neynar.score", { fids: [{ fid: 987654321, challengeSig: signFid(987654321, c3) }], challenge: c3, includeCohort: false });
  if (unknown.response?.refused !== true || /987654321/.test(refusalOf(unknown))) throw new Error("unknown fid: " + JSON.stringify(unknown).slice(0, 300));
});

// ---- 7. scopes ----
await check("7. SCOPES: after the buckets go live, MAIN proves x.account-age/gte-1y-stable and gte-2y-stable — accepted, both attested — and the nullifiers differ per bucket and per issuer (x, neynar, onchain share nothing)", async () => {
  await advance();
  const census = (await retry(() => zk("attestBuckets"))).json;
  const xb = (census.buckets ?? []).filter((b) => b.issuer === "x.account-age").map((b) => [b.bucket, b.size, b.clearsFloor]);
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  const d1 = await proveVia(MAIN, "x.account-age", "gte-1y-stable");
  const d2 = await proveVia(MAIN, "x.account-age", "gte-2y-stable");
  if (!d1.outcomes?.accepted && !d2.outcomes?.accepted) {
    const attempts = (await retry(() => zk("gateStatus"))).json.attempts.filter((x) => x.claimKind === "attestation").slice(-3);
    throw new Error("no accepted attestation proof: " + JSON.stringify({ epoch: census.epoch, xb, d1, d2, attempts }).slice(0, 700));
  }
  await sleep(300);
  const at = (await retry(() => zk("attested", { personaId: MAIN, issuer: "x.account-age" }))).json;
  if (!at.buckets?.includes("gte-1y-stable") || !at.buckets?.includes("gte-2y-stable")) throw new Error("not attested: " + JSON.stringify(at).slice(0, 300));
  const px = (await retry(() => zk("nullifierProbe", { claimKind: "attestation", personaId: MAIN, issuer: "x.account-age", buckets: ["gte-1y-stable", "gte-2y-stable"] }))).json.nullifiers;
  const pr = (await retry(() => zk("nullifierProbe", { claimKind: "attestation", personaId: MAIN, issuer: "x.account-region", buckets: ["americas"] }))).json.nullifiers;
  const pn = (await retry(() => zk("nullifierProbe", { claimKind: "attestation", personaId: MAIN, issuer: "neynar.score", buckets: ["score-gte-0.7"] }))).json.nullifiers;
  const po = (await retry(() => zk("nullifierProbe", { claimKind: "attestation", personaId: MAIN, issuer: "onchain.wallet-age", buckets: ["gt2y"] }))).json.nullifiers;
  const all = [px["gte-1y-stable"], px["gte-2y-stable"], pr.americas, pn["score-gte-0.7"], po.gt2y];
  if (all.some((x) => !x) || new Set(all).size !== all.length) throw new Error("nullifier collision across the new scopes: " + JSON.stringify(all));
});

// ---- 8. OR-gate onboarding ----
await check("8. OR-GATE: MAIN — tier 0 this epoch, holding only a proven old-X-account attestation — clears onboarding and is discovery-eligible; ALT, with nothing proven, does not clear and is not eligible", async () => {
  const main = (await retry(() => zk("onboardingProbe", { personaId: MAIN }))).json;
  if (main.clears !== true || !/^x\.account-age\/gte-(2|4)y-stable$/.test(main.by ?? "")) throw new Error("MAIN does not clear: " + JSON.stringify(main).slice(0, 300));
  const em = (await retry(() => zk("eligibilityProbe", { personaId: MAIN, legacyTier: 1 }))).json;
  if (em.active !== true || em.provenTier !== 0 || em.eligible !== true) throw new Error("MAIN eligibility: " + JSON.stringify(em).slice(0, 300));
  const alt = (await retry(() => zk("onboardingProbe", { personaId: ALT }))).json;
  if (alt.clears !== false) throw new Error("ALT clears with nothing: " + JSON.stringify(alt).slice(0, 300));
  const ea = (await retry(() => zk("eligibilityProbe", { personaId: ALT, legacyTier: 1 }))).json;
  if (ea.active !== true || ea.eligible !== false) throw new Error("ALT eligibility: " + JSON.stringify(ea).slice(0, 300));
});

await retry(() => zk("setRepImpl", { impl: null }));
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 0 checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
