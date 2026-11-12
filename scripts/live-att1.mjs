// ATTESTATION PASS Gate 2 — live-att1: ONE real issuance, read-only, no
// spend. The test wallet (FC_TEST_CUSTODY_ADDRESS / _PRIVATE_KEY, from the
// environment or .env.local — never printed) signs the issuer's challenge;
// the app's onchain issuers read PUBLIC chain facts through the LIVE
// adapter (public RPC, Blockscout, Snapshot; no API key; eth_getBalance and
// transaction lists only — nothing here can move a coin) and issue the
// buckets the facts support. The response is recorded to
// research/live-att1.json as BUCKETS ONLY: no address, no balance, no
// timestamp, no vote count — the exact values die with the request, on the
// issuer's side, by design.
//
// Requires ZK_DEV_HOOKS=true on the app (the chain-source override is a
// test-rig action); the app is restored to the fixture source afterwards.
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { assertServersUp } from "./lib-health.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const ISSUERS = ["onchain.wallet-age", "onchain.holdings", "onchain.protocol-history", "onchain.governance"];

// .env.local fallback: values are loaded into process.env for THIS process and never echoed
if (!process.env.FC_TEST_CUSTODY_PRIVATE_KEY && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const pk = process.env.FC_TEST_CUSTODY_PRIVATE_KEY || "";
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) {
  console.error("live-att1: FC_TEST_CUSTODY_PRIVATE_KEY is not set (or not a 32-byte hex key) — nothing to sign with. Not printing anything else.");
  process.exit(2);
}
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : "0x" + pk));
if (process.env.FC_TEST_CUSTODY_ADDRESS && process.env.FC_TEST_CUSTODY_ADDRESS.toLowerCase() !== account.address.toLowerCase()) {
  console.error("live-att1: the private key does not derive FC_TEST_CUSTODY_ADDRESS — refusing.");
  process.exit(2);
}

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status(), json };
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });

console.log("\nlive-att1 — one real onchain issuance for the test wallet (read-only; buckets only are printed and recorded)");
console.log("ENABLE_FC_WRITE:", process.env.ENABLE_FC_WRITE ?? "unset", "(irrelevant here: nothing writes to any chain)");

// defence in depth: nothing printed or recorded may carry an address (the
// first run found a transport error quoting the RPC request body)
const redact = (s) => String(s).replace(/0x[0-9a-fA-F]{40}/g, "0x<redacted>");
const record = { at: new Date().toISOString(), mode: "fixture-universe/live-chain-facts", issuers: {}, refusals: {} };
let exit = 0;
try {
  const src = await zk("setChainSource", { source: "live" });
  if (src.status !== 200) throw new Error("setChainSource live refused: " + JSON.stringify(src.json));
  for (const issuerId of ISSUERS) {
    await zk("registerIssuer", { issuerId });
    const ch = (await zk("attestChallenge", { issuerId })).json;
    if (typeof ch.challenge !== "string") { record.refusals[issuerId] = "no challenge"; exit = 1; continue; }
    const challengeSig = await account.signMessage({ message: ch.challenge });
    const r = await zk("requestIssuance", { issuerId, wallets: [{ address: account.address, challengeSig }], challenge: ch.challenge });
    if (r.status === 200 && r.json?.response?.ok) {
      record.issuers[issuerId] = { buckets: r.json.response.buckets, epoch: r.json.response.epoch, activeFromEpoch: r.json.response.activeFromEpoch, expiresEpoch: r.json.response.expiresEpoch };
      console.log(`  ${issuerId}: ${r.json.response.buckets.join(", ") || "(no bucket)"}  active from epoch ${r.json.response.activeFromEpoch}`);
    } else {
      const reason = redact(r.json?.response?.reason ?? r.json?.error ?? r.status).split("\n")[0].slice(0, 200);
      // a refusal because the facts support no bucket is a VALID outcome (the wallet is what it is); a transport failure is not
      record.refusals[issuerId] = reason;
      console.log(`  ${issuerId}: refused — ${reason}`);
      if (!/support none/.test(reason)) exit = 1;
    }
  }
} finally {
  await zk("setChainSource", { source: null });
  const restored = (await zk("chainSource")).json;
  record.chainSourceAfter = restored?.source ?? "unknown";
  await browser.close();
}
mkdirSync("research", { recursive: true });
writeFileSync(path.join("research", "live-att1.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`\nrecorded research/live-att1.json (chain source restored: ${record.chainSourceAfter})`);
process.exit(exit);
