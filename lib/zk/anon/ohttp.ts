import "server-only";
// ZK PASS 1 Gate 1 — Oblivious HTTP (RFC 9458) CLIENT side.
//
// Request encapsulation (§4.3): hdr = key_id(1) kem_id(2) kdf_id(2)
// aead_id(2); info = "message/bhttp request" || 0x00 || hdr; (enc, ctx) =
// SetupBaseS(pkR, info); ct = ctx.Seal("", bhttp_request); enc_request =
// hdr || enc || ct. Response decapsulation (§4.4): secret =
// ctx.Export("message/bhttp response", Nk); salt = enc || response_nonce;
// prk = Extract(salt, secret); key = Expand(prk, "key", Nk); nonce =
// Expand(prk, "nonce", Nn); response = Open(key, nonce, "", ct).
//
// HPKE via @hpke/core (X25519 / HKDF-SHA256 / AES-128-GCM — the RFC 9458
// defaults). ASSUMPTION A-HPKE-AUDIT (posture doc): @hpke/core passes the
// RFC 9180 test vectors but has no formal audit on record. HKDF and
// AES-GCM for the response leg use the platform layer (@noble, the same
// bytes node:crypto produced).
//
// PERSONA LAUNCH P7: browser-safe. The browser device encapsulates IN THE TAB (lib/zk/anon/webChannel.ts carries the
// ciphertext to the relay), so this module uses Uint8Array only — no global Buffer (the device bundle injects one, but a
// Web Worker or a plain page has none, and a silent dependency on the shim is how a later move breaks). @hpke/core runs
// on WebCrypto in both hosts. "server-only" is a no-op in the device bundle (lib/device/shims/server-only.ts).
import { aesGcmOpen, hkdfSha256 } from "@/lib/platform/crypto";
import { Aes128Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";

export const KEM_ID = 0x0020;
export const KDF_ID = 0x0001;
export const AEAD_ID = 0x0001;
const NK = 16;
const NN = 12;
const te = new TextEncoder();

const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });

export interface KeyConfig {
  keyId: number;
  publicKey: Uint8Array;
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Parse an RFC 9458 §3 key configuration (first config only). */
export function parseKeyConfig(bytes: Uint8Array): KeyConfig {
  if (bytes.length < 1 + 2 + 32 + 2 + 4) throw new Error("ohttp: key config too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyId = view.getUint8(0);
  const kem = view.getUint16(1);
  if (kem !== KEM_ID) throw new Error(`ohttp: unsupported KEM 0x${kem.toString(16)}`);
  const publicKey = bytes.subarray(3, 3 + 32);
  const symLen = view.getUint16(35);
  let ok = false;
  for (let o = 37; o + 4 <= 37 + symLen; o += 4) {
    if (view.getUint16(o) === KDF_ID && view.getUint16(o + 2) === AEAD_ID) ok = true;
  }
  if (!ok) throw new Error("ohttp: gateway does not offer HKDF-SHA256/AES-128-GCM");
  return { keyId, publicKey };
}

export interface Encapsulated {
  encRequest: Uint8Array;
  /** decapsulate the gateway's response; throws on any tamper / mismatch */
  open(encResponse: Uint8Array): Promise<Uint8Array>;
}

export async function encapsulateRequest(cfg: KeyConfig, bhttpRequest: Uint8Array): Promise<Encapsulated> {
  const hdr = new Uint8Array(7);
  const hv = new DataView(hdr.buffer);
  hv.setUint8(0, cfg.keyId);
  hv.setUint16(1, KEM_ID);
  hv.setUint16(3, KDF_ID);
  hv.setUint16(5, AEAD_ID);
  const label = te.encode("message/bhttp request");
  const info = new Uint8Array(label.length + 1 + hdr.length);
  info.set(label, 0);
  info[label.length] = 0;
  info.set(hdr, label.length + 1);
  const pk = await suite.kem.deserializePublicKey(cfg.publicKey.slice().buffer);
  const sender = await suite.createSenderContext({ recipientPublicKey: pk, info: info.slice().buffer });
  const ct = new Uint8Array(await sender.seal(bhttpRequest.slice().buffer, new ArrayBuffer(0)));
  const enc = new Uint8Array(sender.enc);
  const encRequest = concatBytes(hdr, enc, ct);
  const secret = new Uint8Array(await sender.export(te.encode("message/bhttp response").slice().buffer, NK));
  return {
    encRequest,
    async open(encResponse: Uint8Array): Promise<Uint8Array> {
      const nonceLen = Math.max(NK, NN);
      if (encResponse.length < nonceLen + 16) throw new Error("ohttp: response too short");
      const responseNonce = encResponse.slice(0, nonceLen);
      const salt = concatBytes(enc, responseNonce);
      const key = new Uint8Array(hkdfSha256(secret, salt, "key", NK));
      const nonce = new Uint8Array(hkdfSha256(secret, salt, "nonce", NN));
      const ct = encResponse.slice(nonceLen);
      return new Uint8Array(aesGcmOpen(key, nonce, ct));
    },
  };
}
