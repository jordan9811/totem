// CRYPTO PASS — GATE 0: key hierarchy, device delegation, key-material
// confinement. FIXTURE-SAFE: never posts, never spends; talks only to
// the local app + validator.
//
// DELIBERATE DUPLICATES (substrate.test.js discipline): this suite
// re-derives the HKDF tree and re-verifies signatures with its own noble
// imports. If the app's derivation drifts from this file, determinism
// checks fail — that is the point. If canonical forms drift between
// lib/identity/deviceKeys.ts and validator/crypto.js, the sign-here/
// verify-there tests fail — also the point.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync, existsSync } from "node:fs";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { ed25519 } from "@noble/curves/ed25519";
import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");

// ---- the deliberate duplicate of lib/crypto/kdf.ts ----
const DOMAIN = "layers/v1/";
const derive = (seed, info) => hkdf(sha256, seed, new Uint8Array(0), te.encode(DOMAIN + info), 32);
const personaSignSeed = (seed, nonce) => derive(seed, "persona-sign/" + nonce);
const vaultKey = (seed) => derive(seed, "vault/1");
const deviceAuthSeed = (seed) => derive(seed, "device-auth/1");
const FIXTURE_MASTER = te.encode("layers-fixture-master/v1");
const fixtureSeed = (accountId) =>
  hkdf(sha256, FIXTURE_MASTER, new Uint8Array(0), te.encode(DOMAIN + "fixture-root/" + accountId), 32);

// ---- the deliberate duplicate of the canonical forms ----
const delegationCanonical = (d) =>
  ["layers-device-delegation/1", d.deviceId, d.devicePubKey, d.scopes.join(","), String(d.issuedAt), String(d.expiresAt ?? "")].join("|");
const envelopeCanonical = (ns, bodyHashHex, counter) =>
  ["layers-envelope/1", ns, bodyHashHex, String(counter)].join("|");

const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  results.push([infra ? "INFRA" : "FAIL", n, d]);
  console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {}
  return { status: res.status(), json };
}
async function vapi(method, url, body, headers = {}) {
  const res = await fetch(VBASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {}
  return { status: res.status, json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r.status >= 200 && r.status < 300) return r;
      last = new Error("status " + r.status + " " + (r.json?.error ?? ""));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

console.log("\nCRYPTO Gate 0 — key hierarchy, device delegation, confinement");

// needle set: everything that must never appear in any outward payload
function needleSet() {
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  const seed = new Uint8Array(Buffer.from(ks.rootSecretHex, "hex"));
  const needles = [ks.rootSecretHex, toHex(vaultKey(seed)), toHex(deviceAuthSeed(seed))];
  for (const p of ks.personas ?? []) needles.push(toHex(personaSignSeed(seed, p.nonce)));
  if (existsSync(".keystore/device.json")) {
    needles.push(JSON.parse(readFileSync(".keystore/device.json", "utf8")).privHex);
  }
  return { needles, seed, ks };
}

// ---- 1. determinism + roundtrip via the real route ----
let probe = null;
await check("1. Re-derivation determinism + sign/verify roundtrip (cryptoProbe)", async () => {
  const r = await retry(() => api("POST", "/api/dev", { action: "cryptoProbe" }));
  probe = r.json;
  if (!probe.derivedTwiceIdentical) throw new Error("same derivation twice gave different keys");
  if (!probe.roundtrip) throw new Error("sign→verify roundtrip failed");
  if (!probe.tamperRejected) throw new Error("a tampered canonical still verified");
  if (!probe.unknownPersonaKeyIsNull) throw new Error("an unknown persona resolved a key — fail-open");
  const nonNull = Object.values(probe.fixtureKeys ?? {}).filter(Boolean);
  if (nonNull.length < 3) throw new Error(`expected 3 fixture keys, got ${nonNull.length}`);
});

// ---- 2. the fixture derivation is what we think it is ----
await check("2. Fixture keys match the independent in-script derivation", async () => {
  for (const [personaId, pubHex] of Object.entries(probe.fixtureKeys)) {
    if (!pubHex) continue;
    const expect = toHex(ed25519.getPublicKey(personaSignSeed(fixtureSeed(personaId), personaId)));
    if (expect !== pubHex)
      throw new Error(`fixture key for ${personaId} diverges from the duplicate derivation`);
  }
});

// ---- 3. SAFETY: key material appears NOWHERE outward ----
await check("3. SAFETY: key-material leak grep across app + validator surfaces", async () => {
  const { needles } = needleSet();
  if (needles.length < 3) throw new Error("needle set implausibly small");
  const surfaces = [
    ["cryptoProbe", JSON.stringify(probe)],
    ["GET /api/dev", JSON.stringify((await api("GET", "/api/dev")).json)],
    ["GET /api/personas", JSON.stringify((await api("GET", "/api/personas")).json)],
    ["GET /api/feed2", JSON.stringify((await api("GET", "/api/feed2?surface=home")).json)],
    ["validator GET /state", JSON.stringify((await vapi("GET", "/state")).json)],
    ["validator /device/list", JSON.stringify((await vapi("GET", "/device/list")).json)],
  ];
  for (const [name, payload] of surfaces) {
    for (const n of needles) {
      if (payload.includes(n)) throw new Error(`key material found in ${name}`);
    }
  }
});

// ---- 4. enforcement is ARMED (the pass's core run config) ----
await check("4. SAFETY: validator envelope enforcement is ARMED (LAYERS_REQUIRE_SIG)", async () => {
  const bare = await vapi("PUT", "/state/c0Probe", { entries: { probe: { at: Date.now() } } });
  if (bare.status !== 401)
    throw new Error(
      `unsigned state write returned ${bare.status} — the validator is not enforcing envelopes; run it with LAYERS_REQUIRE_SIG=true`
    );
});

// ---- 5. the delegation chain: authorize a device WITHOUT the seed ----
let dev = null; // { deviceId, priv, pubHex, delegation, anchorPubKey }
await check("5. Device delegation: issued, verified in-script, registered, accepted", async () => {
  const priv = new Uint8Array(randomBytes(32));
  const pubHex = toHex(ed25519.getPublicKey(priv));
  const deviceId = "dev_c0_" + randomBytes(4).toString("hex");
  const issued = await retry(() =>
    api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: pubHex, deviceId })
  );
  const { delegation, anchorPubKey } = issued.json;
  // pin the canonical form: verify HERE with the duplicate
  if (!ed25519.verify(
    Buffer.from(delegation.signature, "hex"),
    te.encode(delegationCanonical(delegation)),
    Buffer.from(anchorPubKey, "hex")
  ))
    throw new Error("delegation does not verify against the anchor with the duplicate canonical — forms drifted");
  // anchor idempotency; and — BROWSER KEYSTORE PASS Gate 1 stage 2 (docs/custody-model.md D-CU-0-5) — a stranger's
  // anchor is THEIR OWN root, not a rotation of ours: one anchor per root, state keyed by anchor.
  const again = await vapi("POST", "/device/auth-anchor", { pubkey: anchorPubKey });
  if (![200, 201].includes(again.status)) throw new Error(`anchor re-register: ${again.status}`);
  const strangerPub = toHex(ed25519.getPublicKey(new Uint8Array(randomBytes(32))));
  const stranger = await vapi("POST", "/device/auth-anchor", { pubkey: strangerPub });
  if (stranger.status !== 201) throw new Error(`a second root's anchor was refused (${stranger.status}) — the validator is still single-tenant`);
  const oursStill = await vapi("POST", "/device/auth-anchor", { pubkey: anchorPubKey });
  if (oursStill.status !== 200 || oursStill.json?.existing !== true) throw new Error("our anchor did not survive a stranger registering theirs");
  const junk = await vapi("POST", "/device/auth-anchor", { pubkey: "ab".repeat(32) });
  if (junk.status !== 400) throw new Error(`an unusable key was accepted as an anchor (${junk.status})`);
  // register the device — naming the anchor it was issued under (BROWSER KEYSTORE PASS Gate 5: the validator no
  // longer scans every anchor for an unnamed delegation; the app always names it)
  const reg = await vapi("POST", "/device/register", { delegation, anchorPubKey });
  if (reg.status !== 201) throw new Error(`register: ${reg.status} ${reg.json?.error ?? ""}`);
  // tampered delegation refused
  const tampered = { ...delegation, scopes: ["state-write", "everything"] };
  const bad = await vapi("POST", "/device/register", { delegation: tampered, anchorPubKey });
  if (bad.status !== 403) throw new Error(`tampered delegation accepted (${bad.status})`);
  dev = { deviceId, priv, pubHex, delegation, anchorPubKey };
});

// ---- 6. the device WRITES, the validator verifies; replay + tamper refused ----
await check("6. Device-signed write accepted; replay and tampered envelopes refused", async () => {
  const entries = { probe: { at: Date.now(), by: dev.deviceId } };
  const bodyHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const counter = Date.now();
  const sign = (c) => toHex(ed25519.sign(te.encode(c), dev.priv));
  const headers = (ctr, sig) => ({
    "x-layers-device": dev.deviceId,
    "x-layers-counter": String(ctr),
    "x-layers-sig": sig ?? sign(envelopeCanonical("c0Probe", bodyHash, ctr)),
  });
  const okPut = await vapi("PUT", "/state/c0Probe", { entries }, headers(counter));
  if (okPut.status !== 200) throw new Error(`signed write refused: ${okPut.status} ${okPut.json?.error ?? ""}`);
  // replay: same counter again
  const replay = await vapi("PUT", "/state/c0Probe", { entries }, headers(counter));
  if (replay.status !== 409) throw new Error(`replayed counter accepted (${replay.status})`);
  // tamper: body changed, signature stale
  const evil = await vapi(
    "PUT",
    "/state/c0Probe",
    { entries: { probe: { at: 0, by: "attacker" } } },
    headers(counter + 1, sign(envelopeCanonical("c0Probe", bodyHash, counter + 1)))
  );
  if (evil.status !== 401) throw new Error(`tampered body accepted (${evil.status}) — bodyHash not actually checked`);
});

// ---- 7. SEED-ABSENT: what the device context holds contains no seed ----
await check("7. SAFETY: the device's material (delegation + envelope) carries no seed", async () => {
  const { needles } = needleSet();
  const deviceContext = JSON.stringify({
    delegation: dev.delegation,
    envelopeSample: envelopeCanonical("c0Probe", "00".repeat(32), 1),
    devicePriv: toHex(dev.priv), // the device's OWN key — allowed in ITS context
  });
  for (const n of needles) {
    if (deviceContext.includes(n)) throw new Error("seed-derived material found in the device context");
  }
});

// ---- 8. revocation: forward-looking refusal ----
await check("8. Revoked device is refused; a revoked id cannot re-register", async () => {
  const rev = await retry(() => api("POST", "/api/dev", { action: "revokeDevice", deviceId: dev.deviceId }));
  const posted = await vapi("POST", "/device/revoke", rev.json);
  if (posted.status !== 200) throw new Error(`revoke refused: ${posted.status} ${posted.json?.error ?? ""}`);
  const entries = { probe: { at: Date.now() } };
  const bodyHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const counter = Date.now() + 10;
  const sig = toHex(ed25519.sign(te.encode(envelopeCanonical("c0Probe", bodyHash, counter)), dev.priv));
  const after = await vapi("PUT", "/state/c0Probe", { entries }, {
    "x-layers-device": dev.deviceId,
    "x-layers-counter": String(counter),
    "x-layers-sig": sig,
  });
  if (after.status !== 403) throw new Error(`revoked device still writes (${after.status})`);
  const reReg = await vapi("POST", "/device/register", { delegation: dev.delegation, anchorPubKey: dev.anchorPubKey });
  if (reReg.status !== 403) throw new Error(`revoked device id re-registered (${reReg.status}) — revocation is a suggestion`);
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} CRYPTO Gate 0 checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
