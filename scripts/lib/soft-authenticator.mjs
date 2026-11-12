// OWNER PASSKEYS (D-OWNER-PASSKEYS) — A SOFTWARE WebAuthn AUTHENTICATOR for scripts/unit-owner-passkeys.mjs. It
// builds exactly what a browser hands the server: clientDataJSON, authenticatorData (with attested credential data
// and a real COSE key at registration), the SPKI the browser's getPublicKey() would return, and signatures over
// authenticatorData ‖ SHA-256(clientDataJSON).
//   ES256  — @noble/curves p256 (the repo's own dependency), DER signatures as browsers send them
//   EdDSA  — node:crypto Ed25519
//   RS256  — node:crypto RSA (PKCS#1 v1.5), any modulus length (a short one tests the refusal)
// Every field can be tampered with per call, so each server check can be driven to fail on its own.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { p256 } = require("@noble/curves/p256");

const sha256 = (b) => createHash("sha256").update(b).digest();
const b64url = (b) => Buffer.from(b).toString("base64url");
const P256_SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

export class SoftAuthenticator {
  /**
   * @param {{alg?: number, be?: boolean, bs?: boolean, counter?: number, counterStep?: number, rsaBits?: number}} o
   *   counterStep 0 = a synced passkey that always reports 0
   */
  constructor(o = {}) {
    this.alg = o.alg ?? -7;
    this.be = o.be ?? false;
    this.bs = o.bs ?? false;
    this.counter = o.counter ?? 0;
    this.counterStep = o.counterStep ?? 1;
    this.credId = randomBytes(32);
    this.aaguid = randomBytes(16);
    this.userHandle = null;
    if (this.alg === -7) {
      this.priv = p256.utils.randomPrivateKey();
      const pub = Buffer.from(p256.getPublicKey(this.priv, false)); // 04 ‖ x ‖ y
      this.x = pub.subarray(1, 33);
      this.y = pub.subarray(33, 65);
      this.spki = Buffer.concat([P256_SPKI_PREFIX, pub]);
      this.cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), this.x, Buffer.from([0x22, 0x58, 0x20]), this.y]);
    } else if (this.alg === -8) {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      this.keyObj = privateKey;
      this.spki = publicKey.export({ type: "spki", format: "der" });
      const x = this.spki.subarray(this.spki.length - 32);
      this.cose = Buffer.concat([Buffer.from([0xa4, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21, 0x58, 0x20]), x]);
    } else if (this.alg === -257) {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: o.rsaBits ?? 2048 });
      this.keyObj = privateKey;
      this.spki = publicKey.export({ type: "spki", format: "der" });
      const jwk = publicKey.export({ format: "jwk" });
      const n = Buffer.from(jwk.n, "base64url");
      const e = Buffer.from(jwk.e, "base64url");
      const nHead = n.length > 255 ? Buffer.from([0x59, n.length >> 8, n.length & 255]) : Buffer.from([0x58, n.length]);
      this.cose = Buffer.concat([Buffer.from([0xa4, 0x01, 0x03, 0x03, 0x39, 0x01, 0x00, 0x20]), nHead, n, Buffer.from([0x21, 0x40 + e.length]), e]);
    } else throw new Error("unsupported alg " + this.alg);
  }

  /** the private key's own bytes, to prove they never reach the server's file */
  privateMarker() {
    if (this.alg === -7) return Buffer.from(this.priv).toString("hex");
    return this.keyObj.export({ format: "der", type: "pkcs8" }).toString("hex").slice(-64);
  }

  signBytes(data) {
    if (this.alg === -7) return Buffer.from(p256.sign(sha256(data), this.priv).toDERRawBytes());
    if (this.alg === -8) return nodeSign(null, data, this.keyObj);
    return nodeSign("sha256", data, this.keyObj);
  }

  flags({ up = true, uv = true, be = this.be, bs = this.bs, at = false } = {}) {
    return (up ? 0x01 : 0) | (uv ? 0x04 : 0) | (be ? 0x08 : 0) | (bs ? 0x10 : 0) | (at ? 0x40 : 0);
  }

  /** navigator.credentials.create(), as the owner's browser would report it */
  create({ challenge, rpId, origin, userHandle, up, uv, be, bs, type = "webauthn.create", crossOrigin, rpIdOverride, rawIdOverride, algOverride, spkiOverride }) {
    this.userHandle = userHandle;
    const cd = { type, challenge, origin, ...(crossOrigin !== undefined ? { crossOrigin } : {}) };
    const clientDataJSON = Buffer.from(JSON.stringify(cd));
    const authData = Buffer.concat([
      sha256(rpIdOverride ?? rpId),
      Buffer.from([this.flags({ up, uv, be, bs, at: true })]),
      u32(this.counter),
      this.aaguid,
      Buffer.from([this.credId.length >> 8, this.credId.length & 255]),
      this.credId,
      this.cose,
    ]);
    const rawId = rawIdOverride ?? this.credId;
    return {
      id: b64url(rawId),
      rawId: b64url(rawId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        publicKey: b64url(spkiOverride ?? this.spki),
        publicKeyAlgorithm: algOverride ?? this.alg,
        transports: ["internal", "hybrid"],
      },
    };
  }

  /** navigator.credentials.get(), as the owner's browser would report it — one assertion, the counter advanced */
  get({ challenge, rpId, origin, up, uv, be, bs, type = "webauthn.get", crossOrigin, rpIdOverride, counter, userHandle, omitUserHandle, signWith }) {
    if (counter === undefined) this.counter += this.counterStep;
    const count = counter ?? (this.counterStep === 0 ? 0 : this.counter);
    const cd = { type, challenge, origin, ...(crossOrigin !== undefined ? { crossOrigin } : {}) };
    const clientDataJSON = Buffer.from(JSON.stringify(cd));
    const authData = Buffer.concat([sha256(rpIdOverride ?? rpId), Buffer.from([this.flags({ up, uv, be, bs })]), u32(count)]);
    const signed = Buffer.concat([authData, sha256(clientDataJSON)]);
    const signature = (signWith ?? this).signBytes(signed);
    const uh = omitUserHandle ? null : userHandle ?? this.userHandle;
    return {
      id: b64url(this.credId),
      rawId: b64url(this.credId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: uh,
      },
    };
  }
}
