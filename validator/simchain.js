"use strict";
// PERSONA LAUNCH P6 — THE SIMULATED CHAIN (fixture only, $0, no live branch at all).
//
// What a launched persona's account needs from Optimism, simulated in the validator's own database so a rig can walk
// the whole launch without a wallet, gas or a network call: Farcaster's IdRegistry (fid → custody, recovery), its
// KeyRegistry (fid → signer keys, each vouched by a requestFid), its StorageRegistry (units per fid), and the fname
// server's table (name → fid). One BUNDLER call (bundlerRegister) does what Farcaster's Bundler does in one transaction:
// register the fid to the custody address with its recovery address, add the persona's self-custody signer key, and
// rent one storage unit — verifying the two EIP-712 signatures the persona's own derived custody key made on the device
// (IdGateway Register, KeyGateway Add), exactly as the contracts would.
//
// THE ONE APP FID (D6 / R1): every key on this chain is vouched by ONE Totem registrar app fid (REGISTRAR_APP_FID), so
// "made by Totem" is the uniform fingerprint of every launched account — never the connector's fid (the owner's main
// account's key request), never the anonymous account, never the shared test account. ensureRegistrarApp REFUSES to
// run when the configured environment names any of those as the same number.
//
// NO LIVE MODE EXISTS. Every entry point takes `mode` and throws (or answers 400) for anything but "fixture": the live
// key registry read is F25 (VERIFY-YOURSELF), and the live registrar is the owner's O1. Nothing here opens a socket.
//
// EIP-712 by hand (@noble/hashes keccak + @noble/curves secp256k1, both PRODUCTION dependencies — viem is a dev
// dependency and is not installed in the validator's container). DELIBERATE DUPLICATE of the typed data the client
// signs with viem (lib/launch/request.ts REGISTER_TYPES / ADD_TYPES / the domains); scripts/unit-launch.mjs signs with
// viem on one side and recovers here to pin them. The contract addresses and domain names are Farcaster's published
// ones (docs.farcaster.xyz reference) — VERIFY-YOURSELF before any live use; on the simulated chain they only have to
// match the client's.
//
// LOGGING DISCIPLINE (like zk.js): this module logs nothing.
const { keccak_256 } = require("@noble/hashes/sha3");
const { secp256k1 } = require("@noble/curves/secp256k1");

const MODES = ["fixture"];
/** the Totem registrar's app fid on the simulated chain — DELIBERATE DUPLICATE of lib/launch/request.ts */
const REGISTRAR_APP_FID = 7_000_000;
/** the registrar app's custody on the simulated chain (a fixed sim address: nothing ever signs with it) */
const REGISTRAR_APP_CUSTODY = "0x00000000000000000000000000000000000a7e01";
/** the simulated chain allocates fids above the registrar app's, far below the fixture persona fids (9,000,000+) and
 *  far above the seed's (≤ 4,000,000) — a launched fid never collides with another record's */
const SIM_FID_BASE = REGISTRAR_APP_FID;
const HOUR = 3_600_000;
const hourGrain = (t) => Math.floor(t / HOUR) * HOUR;

// ------------------------------------------------------------------------------------------------ EIP-712 (by hand)
const ID_GATEWAY_DOMAIN = { name: "Farcaster IdGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc25870c6ed6b6c7e41fb078b7656f69" };
const KEY_GATEWAY_DOMAIN = { name: "Farcaster KeyGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc56947c7e7183f8ca4b62398caadf0b" };
const FNAME_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" };
const REGISTER_TYPE = "Register(address to,address recovery,uint256 nonce,uint256 deadline)";
const ADD_TYPE = "Add(address owner,uint32 keyType,bytes key,uint8 metadataType,bytes metadata,uint256 nonce,uint256 deadline)";
const USERNAME_PROOF_TYPE = "UserNameProof(string name,uint256 timestamp,address owner)";
const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

const ADDR_RE = /^0x[0-9a-f]{40}$/;
const kec = (b) => Buffer.from(keccak_256(b));
const strHash = (s) => kec(Buffer.from(String(s), "utf8"));
function u256(n) {
  let v = BigInt(n);
  if (v < 0n || v >= 1n << 256n) throw new Error("uint256 out of range");
  const b = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
}
function addr32(a) {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("address malformed");
  const b = Buffer.alloc(32);
  Buffer.from(a.slice(2), "hex").copy(b, 12);
  return b;
}
function bytesHash(hex) {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("bytes malformed");
  return kec(Buffer.from(hex.slice(2), "hex"));
}
function domainSeparator(d) {
  return kec(Buffer.concat([strHash(DOMAIN_TYPE), strHash(d.name), strHash(d.version), u256(d.chainId), addr32(d.verifyingContract)]));
}
function digestOf(domain, typeString, fields) {
  const structHash = kec(Buffer.concat([strHash(typeString), ...fields]));
  return kec(Buffer.concat([Buffer.from([0x19, 0x01]), domainSeparator(domain), structHash]));
}
/** the address that made a 65-byte (r‖s‖v) signature over a digest — null for anything malformed or high-s */
function recoverAddress(digest, sigHex) {
  try {
    if (typeof sigHex !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sigHex)) return null;
    const raw = Buffer.from(sigHex.slice(2), "hex");
    const v = raw[64];
    const bit = v >= 27 ? v - 27 : v;
    if (bit !== 0 && bit !== 1) return null;
    const sig = secp256k1.Signature.fromCompact(raw.subarray(0, 64).toString("hex"));
    if (sig.hasHighS()) return null; // malleable form: refused, as the contracts' ECDSA library does
    const pub = sig.addRecoveryBit(bit).recoverPublicKey(digest).toRawBytes(false);
    return "0x" + kec(Buffer.from(pub.subarray(1))).subarray(12).toString("hex");
  } catch {
    return null;
  }
}
/** the Add metadata the simulated chain accepts: the registrar app fid as one 32-byte word (A-LAUNCH-ADD-METADATA-ORDER:
 *  on the real chain this is the app's SignedKeyRequestMetadata, which the app must sign BEFORE the device signs Add) */
function addMetadataFor(appFid = REGISTRAR_APP_FID) {
  return "0x" + u256(appFid).toString("hex");
}
function registerDigest({ to, recovery, nonce, deadline }) {
  return digestOf(ID_GATEWAY_DOMAIN, REGISTER_TYPE, [addr32(to), addr32(recovery), u256(nonce), u256(deadline)]);
}
function addDigest({ owner, keyType, key, metadataType, metadata, nonce, deadline }) {
  return digestOf(KEY_GATEWAY_DOMAIN, ADD_TYPE, [addr32(owner), u256(keyType), bytesHash(key), u256(metadataType), bytesHash(metadata), u256(nonce), u256(deadline)]);
}
function usernameProofDigest({ name, timestamp, owner }) {
  return digestOf(FNAME_DOMAIN, USERNAME_PROOF_TYPE, [strHash(name), u256(timestamp), addr32(owner)]);
}

/** do the two launch signatures recover to the custody address? (null = yes; otherwise the reason, in words) */
function launchSignaturesProblem(req) {
  const deadline = Number(req.deadlineDay) * 86_400; // seconds: the end of the quantized day (never the click time)
  const by = recoverAddress(registerDigest({ to: req.custody, recovery: req.recovery, nonce: 0, deadline }), req.registerSig);
  if (!by || by !== req.custody) return "the Register signature was not made by the account's custody key";
  const add = { owner: req.custody, keyType: 1, key: "0x" + req.signerKey, metadataType: 1, metadata: addMetadataFor(), nonce: 0, deadline };
  const by2 = recoverAddress(addDigest(add), req.addSig);
  if (!by2 || by2 !== req.custody) return "the Add signature was not made by the account's custody key";
  return null;
}

// ------------------------------------------------------------------------------------------------ the tables
function assertMode(mode) {
  if (!MODES.includes(mode)) throw new Error("the simulated chain has no live mode — the live key registry is not read in this build (F25)");
}

/** the env-configured fids the registrar app fid must never equal (names read here; values never logged) */
function forbiddenAppFids(env = process.env) {
  const out = {};
  for (const name of ["FC_CONNECT_APP_FID", "FC_ANON_FID", "FC_TEST_FID"]) {
    const raw = String(env[name] ?? "").trim();
    if (/^[1-9][0-9]{0,11}$/.test(raw)) out[name] = Number(raw);
  }
  return out;
}

/** the registrar app fid exists on the chain (idempotent) — and is none of the accounts it must never be */
function ensureRegistrarApp(db, mode, env = process.env) {
  assertMode(mode);
  for (const [name, fid] of Object.entries(forbiddenAppFids(env))) {
    if (fid === REGISTRAR_APP_FID) throw new Error(`the Totem registrar app fid must differ from ${name} — one shared number would link launched accounts to that account`);
  }
  db.prepare("INSERT OR IGNORE INTO sim_chain_fids (mode, fid, custody, recovery, registered_at, storage_units, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(mode, REGISTRAR_APP_FID, REGISTRAR_APP_CUSTODY, REGISTRAR_APP_CUSTODY, 0, 1, "genesis");
}

function fidOfCustody(db, mode, custody) {
  assertMode(mode);
  const r = db.prepare("SELECT fid FROM sim_chain_fids WHERE mode = ? AND custody = ?").get(mode, String(custody).toLowerCase());
  return r ? r.fid : null;
}
function fidInfo(db, mode, fid) {
  assertMode(mode);
  const r = db.prepare("SELECT fid, custody, recovery, registered_at, storage_units FROM sim_chain_fids WHERE mode = ? AND fid = ?").get(mode, fid);
  if (!r) return null;
  const n = db.prepare("SELECT fname FROM sim_chain_fnames WHERE mode = ? AND fid = ? ORDER BY set_at DESC LIMIT 1").get(mode, fid);
  return { fid: r.fid, custody: r.custody, recovery: r.recovery, registeredAt: r.registered_at, storageUnits: r.storage_units, fname: n ? n.fname : null };
}
function keysOf(db, mode, fid) {
  assertMode(mode);
  return db
    .prepare("SELECT key, key_type, request_fid, added_at, removed_at FROM sim_chain_keys WHERE mode = ? AND fid = ? ORDER BY added_at, key")
    .all(mode, fid)
    .map((r) => ({ key: r.key, keyType: r.key_type, requestFid: r.request_fid, addedAt: r.added_at, removedAt: r.removed_at ?? null }));
}
/** is `key` an ACTIVE signer key of `fid` on the simulated KeyRegistry? */
function isActiveKey(db, mode, fid, key) {
  assertMode(mode);
  if (typeof key !== "string" || !/^[0-9a-f]{64}$/i.test(key)) return false;
  const r = db.prepare("SELECT 1 FROM sim_chain_keys WHERE mode = ? AND fid = ? AND key = ? AND removed_at IS NULL").get(mode, fid, key.toLowerCase());
  return !!r;
}

/**
 * THE BUNDLER CALL: register + add the self-custody signer + rent storage, in ONE call (Farcaster's Bundler does all
 * three in one transaction). `req` is a parsed launch request (validator/registrar.js parseLaunchRequest). Refuses —
 * {error} and nothing written — when the custody address already owns a fid, the signer key is already on the chain,
 * the deadline has passed at `atMs`, or either signature was not made by the custody key. Runs inside the caller's
 * transaction (registrar.js runDueBatches); it never opens its own.
 */
function bundlerRegister(db, mode, req, batchId, atMs) {
  assertMode(mode);
  ensureRegistrarApp(db, mode);
  if (!ADDR_RE.test(req.custody) || !ADDR_RE.test(req.recovery) || !/^[0-9a-f]{64}$/.test(req.signerKey)) return { error: "the request's addresses or key are malformed" };
  if (fidOfCustody(db, mode, req.custody) !== null) return { error: "that custody address already owns an account" };
  if (db.prepare("SELECT 1 FROM sim_chain_keys WHERE mode = ? AND key = ?").get(mode, req.signerKey)) return { error: "that signer key is already on an account" };
  if (Number(req.deadlineDay) * 86_400_000 < atMs) return { error: "the request's deadline passed before its batch ran" };
  const sigProblem = launchSignaturesProblem(req);
  if (sigProblem) return { error: sigProblem };
  const max = db.prepare("SELECT MAX(fid) AS m FROM sim_chain_fids WHERE mode = ?").get(mode).m;
  const fid = Math.max(Number(max) || 0, SIM_FID_BASE) + 1;
  db.prepare("INSERT INTO sim_chain_fids (mode, fid, custody, recovery, registered_at, storage_units, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(mode, fid, req.custody, req.recovery, atMs, 1, batchId);
  db.prepare("INSERT INTO sim_chain_keys (mode, fid, key, key_type, request_fid, added_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(mode, fid, req.signerKey, 1, REGISTRAR_APP_FID, atMs);
  return { fid };
}

/**
 * THE SIMULATED FNAME SERVER: set `name` for `fid`, proven by an EIP-712 UserNameProof signed by the fid's CUSTODY key
 * (as fnames.farcaster.xyz requires). Reached through the thin relay (lib/fc/thinRelay.ts) after registration — never
 * pre-signed at the click. The timestamp must be within an hour of the name server's (real) clock; a name another fid holds is
 * refused; a fid that had another name moves to this one.
 */
function setFname(db, mode, body, nowMs) {
  assertMode(mode);
  const name = String(body.name || "");
  const fid = Number(body.fid);
  const owner = String(body.owner || "").toLowerCase();
  const timestamp = Number(body.timestamp);
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(name)) return { status: 400, json: { error: "an fname is 1 to 16 lowercase letters, digits or hyphens, not starting with a hyphen" } };
  if (!Number.isInteger(fid) || fid <= 0) return { status: 400, json: { error: "fid required" } };
  if (!Number.isInteger(timestamp) || Math.abs(timestamp * 1000 - nowMs) > HOUR) return { status: 400, json: { error: "the name proof's timestamp is not current" } };
  const info = fidInfo(db, mode, fid);
  if (!info) return { status: 404, json: { error: "no such account" } };
  if (owner !== info.custody) return { status: 403, json: { error: "the name proof's owner is not the account's custody address" } };
  const by = recoverAddress(usernameProofDigest({ name, timestamp, owner }), String(body.signature || ""));
  if (!by || by !== info.custody) return { status: 400, json: { error: "the name proof was not signed by the account's custody key" } };
  const held = db.prepare("SELECT fid FROM sim_chain_fnames WHERE mode = ? AND fname = ?").get(mode, name);
  if (held && held.fid !== fid) return { status: 409, json: { error: "that name belongs to another account" } };
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM sim_chain_fnames WHERE mode = ? AND fid = ?").run(mode, fid);
    db.prepare("INSERT INTO sim_chain_fnames (mode, fname, fid, set_at) VALUES (?, ?, ?, ?)").run(mode, name, fid, hourGrain(nowMs));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return { status: 500, json: { error: "name not recorded: " + e.message } };
  }
  return { status: 200, json: { ok: true, fname: name, fid } };
}

function resetSimChain(db, mode) {
  assertMode(mode);
  for (const t of ["sim_chain_fids", "sim_chain_keys", "sim_chain_fnames"]) db.prepare(`DELETE FROM ${t} WHERE mode = ?`).run(mode);
}

/** the routes: public READS of public chain facts, and the simulated fname server. Fixture only. */
function mountSimChain(app, db) {
  const modeOf = (req, res) => {
    const mode = String((req.query && req.query.mode) || (req.body && req.body.mode) || "fixture");
    if (!MODES.includes(mode)) {
      res.status(400).json({ error: "the simulated chain has no live mode — the live key registry is not read in this build (F25)" });
      return null;
    }
    return mode;
  };
  app.get("/sim-chain/fid", (req, res) => {
    const mode = modeOf(req, res);
    if (!mode) return;
    let fid = null;
    if (req.query.custody !== undefined) {
      const c = String(req.query.custody).toLowerCase();
      if (!ADDR_RE.test(c)) return res.status(400).json({ error: "custody malformed" });
      fid = fidOfCustody(db, mode, c);
    } else {
      fid = Number(req.query.fid);
      if (!Number.isInteger(fid) || fid <= 0) return res.status(400).json({ error: "fid or custody required" });
    }
    const info = fid === null ? null : fidInfo(db, mode, fid);
    if (!info) return res.status(404).json({ error: "no such account on the simulated chain" });
    res.json({ ...info, mode, simulated: true });
  });
  app.get("/sim-chain/keys", (req, res) => {
    const mode = modeOf(req, res);
    if (!mode) return;
    const fid = Number(req.query.fid);
    if (!Number.isInteger(fid) || fid <= 0) return res.status(400).json({ error: "fid required" });
    res.json({ fid, mode, simulated: true, keys: keysOf(db, mode, fid) });
  });
  app.get("/sim-chain/fname/:name", (req, res) => {
    const mode = modeOf(req, res);
    if (!mode) return;
    const r = db.prepare("SELECT fname, fid, set_at FROM sim_chain_fnames WHERE mode = ? AND fname = ?").get(mode, String(req.params.name || ""));
    if (!r) return res.status(404).json({ error: "no such name on the simulated fname server" });
    res.json({ fname: r.fname, fid: r.fid, setAt: r.set_at, mode, simulated: true });
  });
  app.post("/sim-chain/fname", (req, res) => {
    const mode = modeOf(req, res);
    if (!mode) return;
    const r = setFname(db, mode, req.body || {}, Date.now());
    res.status(r.status).json(r.json);
  });
}

module.exports = {
  mountSimChain,
  bundlerRegister,
  setFname,
  ensureRegistrarApp,
  fidOfCustody,
  fidInfo,
  keysOf,
  isActiveKey,
  resetSimChain,
  launchSignaturesProblem,
  // pinned by scripts/unit-launch.mjs against viem
  registerDigest,
  addDigest,
  usernameProofDigest,
  recoverAddress,
  addMetadataFor,
  forbiddenAppFids,
  ID_GATEWAY_DOMAIN,
  KEY_GATEWAY_DOMAIN,
  FNAME_DOMAIN,
  REGISTRAR_APP_FID,
  REGISTRAR_APP_CUSTODY,
  SIM_FID_BASE,
};
