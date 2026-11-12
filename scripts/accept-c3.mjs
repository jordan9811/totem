// CRYPTO PASS — GATE 3: device linking (multi-device without copying the
// seed). FIXTURE-SAFE. The SUITE plays the NEW device ("device B") — an
// external keypair the seed-holding Next server has never seen — so
// "the seed never crosses the wire" is checkable by construction: device
// B only ever receives what the API sends it.
//
// Deliberate-duplicate crypto (node:crypto): the linking-channel open,
// the vault-record decrypt, and the envelope sign are re-implemented
// here against the app's noble/webcrypto implementations, pinning the
// formats across two independent codebases.
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import {
  generateKeyPairSync,
  sign as edSign,
  createDecipheriv,
  hkdfSync,
  createHash,
  randomBytes,
} from "node:crypto";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const te = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString("hex");
const ALT = "persona_viewer_alt";

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
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));

// ---- deliberate-duplicate crypto (device B's own implementation) ----
function mkDeviceKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
function openLink(secretHex, sealed) {
  const key = hkdfSync("sha256", Buffer.from(secretHex, "hex"), Buffer.alloc(0), Buffer.from("layers/link/1"), 32);
  const body = Buffer.from(sealed.ct, "hex");
  const tag = body.subarray(body.length - 16);
  const ct = body.subarray(0, body.length - 16);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(sealed.nonce, "hex"));
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
function decryptVaultRecord(vaultKeyHex, rec) {
  const key = Buffer.from(vaultKeyHex, "hex");
  const body = Buffer.from(rec.ct, "hex");
  const tag = body.subarray(body.length - 16);
  const ct = body.subarray(0, body.length - 16);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(rec.nonce, "hex"));
  d.setAAD(Buffer.from(`layers-vault/1|${rec.ns}|${rec.id}`, "utf8"));
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
const envelopeCanonical = (ns, bodyHash, counter) => ["layers-envelope/1", ns, bodyHash, String(counter)].join("|");
function envelopeHeaders(deviceId, priv, ns, entries, counter) {
  const bodyHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return {
    "x-layers-device": deviceId,
    "x-layers-counter": String(counter),
    "x-layers-sig": toHex(edSign(null, te.encode(envelopeCanonical(ns, bodyHash, counter)), priv)),
  };
}

// key material that must NEVER appear in the linking channel or its payload
function seedNeedles() {
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  const seed = new Uint8Array(Buffer.from(ks.rootSecretHex, "hex"));
  const needles = [ks.rootSecretHex];
  // device-auth private seed + persona sign seeds must not cross either
  const kdf = (info) => hkdfSync("sha256", Buffer.from(seed), Buffer.alloc(0), Buffer.from("layers/v1/" + info), 32);
  needles.push(toHex(kdf("device-auth/1")));
  for (const p of ks.personas ?? []) needles.push(toHex(kdf("persona-sign/" + p.nonce)));
  return needles;
}

console.log("\nCRYPTO Gate 3 — device linking without copying the seed");

const B = mkDeviceKeys();
const bDeviceId = "dev_B_" + randomBytes(4).toString("hex");
let secret = null;
let linkId = null;
let payload = null;

// ---- 1. the origin device authorizes device B; relay sees CIPHERTEXT ----
await check("1. linkBegin seals a payload; the relay stores ciphertext only", async () => {
  const r = await retry(() =>
    api("POST", "/api/device", { action: "linkBegin", deviceId: bDeviceId, devicePubKey: B.pubHex })
  );
  secret = r.json.secret;
  linkId = r.json.linkId;
  if (!secret || !linkId) throw new Error("linkBegin returned no secret/linkId");

  // the relay's stored record must be sealed ciphertext, and contain NO
  // seed material (the secret lives only in the API response, not here)
  const relay = await vapi("GET", "/state/deviceLinks");
  const rec = (relay.json.entries ?? {})[linkId];
  if (!rec || rec.v !== 1 || typeof rec.ct !== "string") throw new Error("relay record is not sealed ciphertext");
  const relayText = JSON.stringify(relay.json);
  for (const n of seedNeedles()) {
    if (relayText.includes(n)) throw new Error("SEED-DERIVED MATERIAL on the relay in the clear");
  }
  if (relayText.includes(secret)) throw new Error("the linking secret is stored on the relay — channel compromised");
});

// ---- 2. device B opens the payload with the secret; the SEED is absent ----
await check("2. device B opens the channel; it carries a delegation + vault key, never the seed", async () => {
  const relay = await vapi("GET", "/state/deviceLinks");
  const sealed = (relay.json.entries ?? {})[linkId];
  payload = openLink(secret, sealed);
  if (!payload.delegation || !payload.vaultKeyHex) throw new Error("opened payload missing delegation/vaultKey");
  // the seed / root secret / persona SIGN keys must NOT be in the payload
  // (the vault key legitimately IS — that is what linking transfers)
  const payloadText = JSON.stringify(payload);
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  if (payloadText.includes(ks.rootSecretHex)) throw new Error("THE ROOT SEED crossed the channel");
  const kdf = (info) =>
    toHex(hkdfSync("sha256", Buffer.from(ks.rootSecretHex, "hex"), Buffer.alloc(0), Buffer.from("layers/v1/" + info), 32));
  if (payloadText.includes(kdf("device-auth/1"))) throw new Error("the device-auth private seed crossed the channel");
  for (const p of ks.personas ?? []) {
    if (payloadText.includes(kdf("persona-sign/" + p.nonce)))
      throw new Error("a persona signing key crossed the channel");
  }
  // a WRONG secret must not open it
  let wrongRejected = false;
  try {
    openLink(randomBytes(32).toString("hex"), sealed);
  } catch {
    wrongRejected = true;
  }
  if (!wrongRejected) throw new Error("a wrong secret opened the linking payload");
});

// BROWSER KEYSTORE PASS Gate 5: a registration names the anchor its delegation was issued under (the app always
// does; the validator no longer scans every anchor for an unnamed one). Device B was linked by the rig root, whose
// device-auth key derives from the keystore exactly as lib/identity/keystore.ts derives it.
function rigAnchorPubKey() {
  const ks = JSON.parse(readFileSync(".keystore/root.json", "utf8"));
  const seed = hkdfSync("sha256", Buffer.from(ks.rootSecretHex, "hex"), Buffer.alloc(0), Buffer.from("layers/v1/device-auth/1"), 32);
  return toHex(ed25519.getPublicKey(new Uint8Array(seed)));
}

// ---- 3. device B registers its delegation and WRITES; validator accepts ----
await check("3. device B registers its delegation and makes an envelope-signed write", async () => {
  const reg = await vapi("POST", "/device/register", { delegation: payload.delegation, anchorPubKey: rigAnchorPubKey() });
  if (reg.status !== 201) throw new Error(`device B delegation refused: ${reg.status} ${reg.json?.error ?? ""}`);
  const entries = { probeB: { at: 1, by: bDeviceId } };
  const counter = Date.now();
  const w = await vapi("PUT", "/state/c3ProbeB", { entries }, envelopeHeaders(bDeviceId, B.privateKey, "c3ProbeB", entries, counter));
  if (w.status !== 200) throw new Error(`device B write refused: ${w.status} ${w.json?.error ?? ""}`);
});

// ---- 4. device B READS the vault with the transferred key ----
await check("4. device B decrypts a vaulted private post with the transferred vault key", async () => {
  // origin device (the Next server) posts a private note...
  await viewAs(ALT);
  const CANARY = "device-B-can-read-this-" + randomBytes(3).toString("hex");
  const posted = await retry(() => api("POST", "/api/private/posts", { text: CANARY }));
  const hash = posted.json.post?.hash;
  await viewAs(null);
  // ...device B pulls the CIPHERTEXT from the validator and decrypts it
  // with only the vault key it received over the linking channel
  const stored = (await vapi("GET", "/state/privatePosts")).json.entries ?? {};
  const rec = stored[hash];
  if (!rec) throw new Error("the private post is not on the validator");
  const plain = decryptVaultRecord(payload.vaultKeyHex, rec);
  if (!plain.text || !plain.text.includes(CANARY))
    throw new Error("device B could not decrypt the vault record it was authorized to read");
});

// ---- 5. revoke: device B's next write is refused, forward-only ----
await check("5. revoking device B refuses its future writes (forward-looking)", async () => {
  const rev = await retry(() => api("POST", "/api/device", { action: "revoke", deviceId: bDeviceId }));
  if (!rev.json.ok) throw new Error(`revoke failed: ${rev.json.error}`);
  const entries = { probeB2: { at: 2 } };
  const counter = Date.now() + 100;
  const after = await vapi("PUT", "/state/c3ProbeB", { entries }, envelopeHeaders(bDeviceId, B.privateKey, "c3ProbeB", entries, counter));
  if (after.status !== 403) throw new Error(`a revoked device still wrote (${after.status})`);
  // and it shows as revoked in the management list
  const list = await retry(() => api("GET", "/api/device"));
  const row = (list.json.devices ?? []).find((d) => d.deviceId === bDeviceId);
  if (!row || !row.revokedAt) throw new Error("revoked device not marked revoked in the device list");
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} CRYPTO Gate 3 checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
