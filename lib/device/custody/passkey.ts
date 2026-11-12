// BROWSER KEYSTORE PASS Gate 2 — the passkey client (D-CU-0-8, D-CU-2-PRF-IS-THE-PATH-TO-PREFER).
//
// Registration asks for the `prf` extension and a discoverable credential; unlock is one assertion with no username.
// On the PRF path the assertion's PRF output (a fixed salt) is the KEK source; on the wrap path the assertion is
// what the app server verifies before it releases the KEK. Nothing here touches the seed: it returns credential ids,
// public keys, PRF bytes and assertion material — the custody layer decides what to do with them.
export const PRF_SALT = "layers/prf/v1";

const te = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (b: ArrayBuffer | Uint8Array) => [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface PasskeyCapabilities {
  /** navigator.credentials with the WebAuthn surface exists on this device */
  webauthn: boolean;
  /** a platform authenticator (Touch ID, Windows Hello, Android) is available */
  platform: boolean;
}

export async function passkeyCapabilities(): Promise<PasskeyCapabilities> {
  const webauthn = typeof navigator !== "undefined" && !!navigator.credentials && typeof PublicKeyCredential !== "undefined";
  let platform = false;
  if (webauthn) {
    try {
      platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platform = false;
    }
  }
  return { webauthn, platform };
}

export interface RegisteredPasskey {
  credentialId: string; // base64url
  /** the credential's public key as SPKI DER hex (WebAuthn getPublicKey(); no CBOR) */
  spkiHex: string | null;
  /** COSE algorithm: -8 Ed25519, -7 ES256 */
  alg: number | null;
  /** the authenticator reported the prf extension enabled at creation */
  prfEnabled: boolean;
}

/** Create a discoverable credential, asking for PRF. The user handle is random: the RP never learns a name. */
export async function registerPasskey(opts: { rpId: string; rpName: string; userName: string }): Promise<RegisteredPasskey> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: opts.rpName, id: opts.rpId },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: opts.userName, displayName: opts.userName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -7 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey: the authenticator returned no credential");
  const resp = cred.response as AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer | null; getPublicKeyAlgorithm?: () => number };
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  const spki = typeof resp.getPublicKey === "function" ? resp.getPublicKey() : null;
  return {
    credentialId: b64url(cred.rawId),
    spkiHex: spki ? hex(spki) : null,
    alg: typeof resp.getPublicKeyAlgorithm === "function" ? resp.getPublicKeyAlgorithm() : null,
    prfEnabled: ext.prf?.enabled === true,
  };
}

export interface PasskeyAssertion {
  credentialId: string; // base64url
  /** 32 PRF bytes when evaluated and supported, else null */
  prf: Uint8Array | null;
  /** the assertion, base64url — what the app server verifies on the wrap path */
  assertion: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle: string | null };
}

/**
 * One assertion. Discoverable: no allow-list unless one is given, so login needs no username. `challenge` is the
 * server's when the wrap path will present this assertion for release; random otherwise (PRF needs no server).
 */
export async function assertPasskey(opts: { rpId: string; challenge?: Uint8Array; evalPrf: boolean; allow?: string[] }): Promise<PasskeyAssertion> {
  const challenge = opts.challenge ?? crypto.getRandomValues(new Uint8Array(32));
  const extensions: AuthenticationExtensionsClientInputs = opts.evalPrf
    ? ({ prf: { eval: { first: te.encode(PRF_SALT) } } } as AuthenticationExtensionsClientInputs)
    : {};
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      rpId: opts.rpId,
      userVerification: "required",
      allowCredentials: opts.allow?.map((id) => ({ type: "public-key" as const, id: fromB64url(id) as BufferSource })),
      extensions,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey: no assertion");
  const resp = cred.response as AuthenticatorAssertionResponse;
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  return {
    credentialId: b64url(cred.rawId),
    prf: first ? new Uint8Array(first) : null,
    assertion: {
      authenticatorData: b64url(resp.authenticatorData),
      clientDataJSON: b64url(resp.clientDataJSON),
      signature: b64url(resp.signature),
      userHandle: resp.userHandle ? b64url(resp.userHandle) : null,
    },
  };
}
