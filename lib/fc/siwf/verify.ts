// PERSONA LAUNCH P1 (SIWF) Gate 1b: THE SIGN IN WITH FARCASTER VERIFIER, pure.
//
// WHY IT IS PURE: verification runs in the visitor's browser (the device), on the rig's server for the suites, and in
// a node harness (scripts/unit-siwf.mjs) against a fake chain. The only I/O is the injected JSON-RPC function, so the
// same bytes verify everywhere and a harness can count every call. No "server-only": nothing here holds a secret.
//
// WHAT IS CHECKED, in order (research/spec-siwf-passkey-first-2026-10-08.txt, THE FLOW a-d):
//   a. the message and signature are present and well formed; the SIWE text parses (viem/siwe parseSiweMessage);
//   b. statement "Farcaster Auth" (the legacy "Farcaster Connect" is NOT accepted: stricter than the reference
//      library, by decision), version 1, chain id 10, domain === the host we sent, the uri's origin === our origin,
//      nonce === ours in BOTH the message and the relay's status, exactly one farcaster:// resource and it is the
//      implementation form farcaster://fid/N (FIP-11's prose form "fids" is refused), N === the status fid, issuedAt
//      within [now - 10 min, now + 2 min], expirationTime (when present) in the future and not past our deadline,
//      notBefore (when present) in the past;
//   c. the signature: a 65-byte signature is recovered LOCALLY (recoverMessageAddress, ZERO RPC: viem's verifyHash
//      would go onchain first in its default mode); anything longer is a contract wallet and goes through viem's
//      ERC-6492 universal validator (a deployless eth_call) over the injected RPC;
//   d. the chain: eth_chainId must be 0xa (once per session); authMethod "custody" needs IdRegistry.idOf(signer) ===
//      fid; "authAddress" needs KeyRegistry.keyDataOf(fid, key) with keyType 2 and state 1. VERIFIED 2026-10-10
//      against farcasterxyz/auth-monorepo packages/auth-client/src/clients/ethereum/viemConnector.ts: the key is
//      encodeAbiParameters([{type: "address"}], [authAddress]), the 32-byte left-padded address, and keyDataOf
//      returns the struct (state, keyType). Any other authMethod is refused.
//
// NEVER A PASS ON A FAILED READ: every RPC failure (unreachable, non-2xx, unreadable, a JSON-RPC error, a wrong chain,
// an undecodable answer) is siwf_chain_unavailable, retryable. A revert of the 6492 validator is its definitive "not
// valid" (siwf_signature); every other JSON-RPC error is "could not check".
//
// NEVER A VALUE IN AN ERROR: every error is one of the fixed sentences below. No message text, signature, address,
// token or upstream text is ever placed in a thrown message (scripts/unit-siwf.mjs U7 greps for each).
import { parseSiweMessage } from "viem/siwe";
import {
  createPublicClient,
  custom,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  recoverMessageAddress,
} from "viem";

export const SIWF_STATEMENT = "Farcaster Auth";
export const SIWF_CHAIN_ID = 10;
/** Optimism mainnet: the same Farcaster contracts lib/fc/connect.ts pins (public reads, no key) */
export const ID_REGISTRY = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b";
export const KEY_REGISTRY = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";
/** the implementation form only (auth-client validate.ts); FIP-11's prose "farcaster://fids/N" is refused */
export const FID_RESOURCE = /^farcaster:\/\/fid\/([1-9]\d*)\/?$/;
export const ISSUED_AT_PAST_MS = 10 * 60_000;
export const ISSUED_AT_FUTURE_MS = 2 * 60_000;
/** an ISO expiration the signer rounds may land a little past our own deadline */
const EXPIRY_GRACE_MS = 60_000;

export const ID_REGISTRY_ABI = [
  { type: "function", name: "idOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "fid", type: "uint256" }] },
] as const;
export const KEY_REGISTRY_ABI = [
  {
    type: "function",
    name: "keyDataOf",
    stateMutability: "view",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "key", type: "bytes" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "keyType", type: "uint32" },
        ],
      },
    ],
  },
] as const;

export type SiwfVerifyCode = "siwf_message" | "siwf_signature" | "siwf_chain_unavailable" | "siwf_fid_mismatch";

/** the fixed sentence for every verifier outcome: plain words, no value from the sign-in */
export const VERIFY_SENTENCES: Record<SiwfVerifyCode, string> = {
  siwf_message: "The signed message does not match this sign-in. Nothing was saved. Start again.",
  siwf_signature: "The signature does not check out. Nothing was saved. Start again.",
  siwf_chain_unavailable: "Couldn't check your account on the Optimism blockchain just now. Still trying.",
  siwf_fid_mismatch: "That signature does not belong to this Farcaster account. Nothing was saved.",
};

export class SiwfVerifyError extends Error {
  readonly code: SiwfVerifyCode;
  readonly retryable: boolean;
  constructor(code: SiwfVerifyCode) {
    super(VERIFY_SENTENCES[code]);
    this.code = code;
    this.retryable = code === "siwf_chain_unavailable";
  }
}

/** what an injected RPC throws: "unavailable" (could not ask, or the node could not answer) or "reverted" (the call
 *  ran and reverted: the node's definitive answer). Never carries a value. */
export class SiwfRpcError extends Error {
  readonly kind: "unavailable" | "reverted";
  constructor(kind: "unavailable" | "reverted") {
    super(kind === "reverted" ? "the call reverted" : "the blockchain node could not be read");
    this.kind = kind;
  }
}

export type SiwfRpc = (method: string, params: unknown[]) => Promise<unknown>;

/** the relay's completed status, as far as the verifier reads it (profile fields are the flow's, not checked here) */
export interface SiwfCompletion {
  message: string;
  signature: string;
  fid: number;
  nonce: string;
  authMethod: string;
}

export interface SiwfExpectation {
  /** the host we sent as `domain` (location.host) */
  domain: string;
  /** our origin (location.origin): the message's uri must be on it */
  origin: string;
  /** the nonce we generated */
  nonce: string;
  /** our session deadline (ms) */
  deadlineMs: number;
  nowMs: number;
}

export interface SiwfVerified {
  fid: number;
  /** the signer: the custody address or the auth address, lowercase */
  address: string;
  authMethod: "custody" | "authAddress";
  issuedAtMs: number;
}

const fail = (code: SiwfVerifyCode): never => {
  throw new SiwfVerifyError(code);
};

/** a. + b.: the message, checked field by field. Pure, no I/O. */
export function checkSiwfMessage(c: SiwfCompletion, expect: SiwfExpectation): { address: string; fid: number; issuedAtMs: number } {
  if (typeof c.message !== "string" || c.message.length < 32 || c.message.length > 4096) fail("siwf_message");
  if (typeof c.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(c.signature) || c.signature.length % 2 !== 0 || c.signature.length < 132 || c.signature.length > 20_000)
    fail("siwf_message");
  if (!Number.isSafeInteger(c.fid) || c.fid <= 0) fail("siwf_message");
  let m: ReturnType<typeof parseSiweMessage>;
  try {
    m = parseSiweMessage(c.message);
  } catch {
    return fail("siwf_message");
  }
  if (m.statement !== SIWF_STATEMENT) fail("siwf_message");
  if (m.version !== "1") fail("siwf_message");
  if (m.chainId !== SIWF_CHAIN_ID) fail("siwf_message");
  if (typeof m.domain !== "string" || m.domain !== expect.domain) fail("siwf_message");
  let uriOrigin = "";
  try {
    uriOrigin = new URL(String(m.uri ?? "")).origin;
  } catch {
    fail("siwf_message");
  }
  if (uriOrigin !== expect.origin) fail("siwf_message");
  if (typeof m.nonce !== "string" || m.nonce !== expect.nonce || c.nonce !== expect.nonce) fail("siwf_message");
  const fc = (m.resources ?? []).filter((r) => typeof r === "string" && r.trim().toLowerCase().startsWith("farcaster:"));
  if (fc.length !== 1) fail("siwf_message");
  const hit = FID_RESOURCE.exec(fc[0].trim());
  if (!hit) fail("siwf_message");
  const resourceFid = Number(hit![1]);
  if (!Number.isSafeInteger(resourceFid) || resourceFid !== c.fid) fail("siwf_message");
  const issued = m.issuedAt instanceof Date ? m.issuedAt.getTime() : NaN;
  if (!Number.isFinite(issued) || issued < expect.nowMs - ISSUED_AT_PAST_MS || issued > expect.nowMs + ISSUED_AT_FUTURE_MS) fail("siwf_message");
  if (m.expirationTime !== undefined) {
    const exp = m.expirationTime instanceof Date ? m.expirationTime.getTime() : NaN;
    if (!Number.isFinite(exp) || exp <= expect.nowMs || exp > expect.deadlineMs + EXPIRY_GRACE_MS) fail("siwf_message");
  }
  if (m.notBefore !== undefined) {
    const nbf = m.notBefore instanceof Date ? m.notBefore.getTime() : NaN;
    if (!Number.isFinite(nbf) || nbf > expect.nowMs) fail("siwf_message");
  }
  if (typeof m.address !== "string" || !isAddress(m.address, { strict: false })) fail("siwf_message");
  return { address: m.address!.toLowerCase(), fid: resourceFid, issuedAtMs: issued };
}

/** one eth_call, its answer decoded; every failure is "could not check" */
async function readCall<T>(rpc: SiwfRpc, to: string, data: `0x${string}`, decode: (hex: `0x${string}`) => T): Promise<T> {
  let raw: unknown;
  try {
    raw = await rpc("eth_call", [{ to, data }, "latest"]);
  } catch {
    return fail("siwf_chain_unavailable");
  }
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) fail("siwf_chain_unavailable");
  try {
    return decode(raw as `0x${string}`);
  } catch {
    return fail("siwf_chain_unavailable");
  }
}

export function idOfCallData(address: string): `0x${string}` {
  return encodeFunctionData({ abi: ID_REGISTRY_ABI, functionName: "idOf", args: [address as `0x${string}`] });
}

/** the auth-address key exactly as the reference connector encodes it (verified against viemConnector.ts) */
export function authAddressKey(address: string): `0x${string}` {
  return encodeAbiParameters([{ name: "authAddress", type: "address" }], [address as `0x${string}`]);
}

export function keyDataOfCallData(fid: number, address: string): `0x${string}` {
  return encodeFunctionData({ abi: KEY_REGISTRY_ABI, functionName: "keyDataOf", args: [BigInt(fid), authAddressKey(address)] });
}

/**
 * Verify a completed sign-in. Throws SiwfVerifyError with a fixed sentence on every refusal. `chainChecked` says the
 * session already read eth_chainId once (the answer says it is now checked).
 */
export async function verifySiwf(
  c: SiwfCompletion,
  expect: SiwfExpectation,
  deps: { rpc: SiwfRpc; chainChecked: boolean }
): Promise<{ verified: SiwfVerified; chainChecked: true }> {
  // a + b
  const { address, fid, issuedAtMs } = checkSiwfMessage(c, expect);

  // c: the signature
  const sig = c.signature as `0x${string}`;
  if (sig.length === 132) {
    // 65 bytes: an EOA signature, recovered LOCALLY (no RPC)
    let recovered = "";
    try {
      recovered = (await recoverMessageAddress({ message: c.message, signature: sig })).toLowerCase();
    } catch {
      fail("siwf_signature");
    }
    if (recovered !== address) fail("siwf_signature");
  } else {
    // a contract wallet (an auth address can be a smart account): viem's ERC-6492 universal validator, deployless,
    // over the injected RPC. viem falls back to local recovery when the call THROWS, so a failed RPC would read as
    // "invalid": the transport below records any "could not ask" and that wins over viem's verdict.
    let unavailable = false;
    const client = createPublicClient({
      transport: custom(
        {
          async request({ method, params }: { method: string; params?: unknown }) {
            try {
              return await deps.rpc(method, Array.isArray(params) ? params : []);
            } catch (e) {
              if (!(e instanceof SiwfRpcError && e.kind === "reverted")) unavailable = true;
              throw e;
            }
          },
        },
        { retryCount: 0 }
      ),
    });
    let ok = false;
    try {
      ok = await client.verifyMessage({ address: address as `0x${string}`, message: c.message, signature: sig });
    } catch {
      ok = false;
    }
    if (unavailable) fail("siwf_chain_unavailable");
    if (!ok) fail("siwf_signature");
  }

  // d: the chain
  if (!deps.chainChecked) {
    let id: unknown;
    try {
      id = await deps.rpc("eth_chainId", []);
    } catch {
      return fail("siwf_chain_unavailable");
    }
    if (typeof id !== "string" || !/^0x[0-9a-fA-F]+$/.test(id) || parseInt(id, 16) !== SIWF_CHAIN_ID) fail("siwf_chain_unavailable");
  }
  let authMethod: "custody" | "authAddress";
  if (c.authMethod === "custody") {
    const owned = await readCall(deps.rpc, ID_REGISTRY, idOfCallData(address), (hex) =>
      decodeFunctionResult({ abi: ID_REGISTRY_ABI, functionName: "idOf", data: hex }) as bigint
    );
    if (typeof owned !== "bigint" || owned !== BigInt(fid)) fail("siwf_fid_mismatch");
    authMethod = "custody";
  } else if (c.authMethod === "authAddress") {
    const kd = await readCall(deps.rpc, KEY_REGISTRY, keyDataOfCallData(fid, address), (hex) =>
      decodeFunctionResult({ abi: KEY_REGISTRY_ABI, functionName: "keyDataOf", data: hex }) as { state: number; keyType: number }
    );
    if (!kd || Number(kd.keyType) !== 2 || Number(kd.state) !== 1) fail("siwf_fid_mismatch");
    authMethod = "authAddress";
  } else {
    return fail("siwf_fid_mismatch");
  }
  return { verified: { fid, address, authMethod, issuedAtMs }, chainChecked: true };
}
