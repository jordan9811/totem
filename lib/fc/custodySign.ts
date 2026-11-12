import "server-only";
// MULTI-FID PASS Gate 2 — typed-data signatures by a persona's fid CUSTODY
// key, inside the key boundary. Neynar's sponsored registration needs an
// EIP-712 `Transfer` by the NEW fid's custody address (Farcaster IdRegistry
// domain); a self-custody KeyGateway add (Call Option A) needs a
// `SignedKeyRequest`. The key is derived from the root (fc-custody/<nonce>)
// and never leaves the keystore module: the user's acquisition command asks
// the app to sign and gets a signature back, never a key.
//
// The typed data is validated HERE against the two shapes this pass knows,
// so a caller cannot turn the custody key into a general-purpose signer:
// only a Transfer to THIS persona's own custody address, or a
// SignedKeyRequest for THIS persona's own derived signer key.
import { fcCustodyAddressFor, fcSignerPublicKeyFor, isKeystoreRootedPersona, signCustodyTypedDataFor } from "@/lib/identity/keys";

/** Farcaster IdRegistry EIP-712 domain (Optimism) and the Transfer type, per farcaster/core */
export const ID_REGISTRY_DOMAIN = {
  name: "Farcaster IdRegistry",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b",
} as const;
export const TRANSFER_TYPES = {
  Transfer: [
    { name: "fid", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Farcaster SignedKeyRequestValidator domain (Optimism) and type, per farcaster/core */
export const SIGNED_KEY_REQUEST_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553",
} as const;
export const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface CustodySignRefusal {
  refused: true;
  reason: string;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** sign the IdRegistry Transfer that accepts a sponsored fid into THIS persona's custody address */
export async function signCustodyTransfer(
  personaId: string,
  input: { fid: number; to: string; nonce: number; deadline: number }
): Promise<{ signature: string; address: string } | CustodySignRefusal> {
  // MULTI-FID Gate 5 (D-FID-5-LIVE-KEYSTORE-ONLY): a custody signature is minted only for a persona whose keys come
  // off the root phrase — a seeded persona's fixture custody key is public, and a Transfer to it would hand the account to the world
  if (!isKeystoreRootedPersona(personaId)) return { refused: true, reason: "custody signatures are minted only for a persona whose keys come off the root phrase (a seeded persona's fixture key is public by construction) — fork or mint a persona first" };
  const addr = fcCustodyAddressFor(personaId);
  if (!addr) return { refused: true, reason: "not one of this device's personas — no custody key" };
  if (String(input.to).toLowerCase() !== addr.toLowerCase()) return { refused: true, reason: "a Transfer may only name THIS persona's own custody address as `to`" };
  // attack-fid-3 #14: one persona, one fid — a second Transfer would move another account into this custody address
  const { personaFidRecord } = await import("./personaFid");
  if (await personaFidRecord(personaId)) return { refused: true, reason: "this persona already owns a fid — a second Transfer is refused" };
  if (!Number.isInteger(input.fid) || input.fid <= 0) return { refused: true, reason: "fid malformed" };
  if (!Number.isInteger(input.nonce) || input.nonce < 0) return { refused: true, reason: "nonce malformed" };
  if (!Number.isInteger(input.deadline) || input.deadline < nowSec() || input.deadline > nowSec() + 3600) return { refused: true, reason: "deadline malformed, past, or more than an hour out" };
  const signature = await signCustodyTypedDataFor(personaId, {
    domain: ID_REGISTRY_DOMAIN,
    types: TRANSFER_TYPES,
    primaryType: "Transfer",
    message: { fid: BigInt(input.fid), to: addr, nonce: BigInt(input.nonce), deadline: BigInt(input.deadline) },
  });
  if (!signature) return { refused: true, reason: "custody key unavailable" };
  return { signature, address: addr };
}

/** sign a SignedKeyRequest for THIS persona's own derived signer key (self-custody, Call Option A) */
export async function signKeyRequest(
  personaId: string,
  input: { requestFid: number; deadline: number }
): Promise<{ signature: string; key: string; address: string } | CustodySignRefusal> {
  if (!isKeystoreRootedPersona(personaId)) return { refused: true, reason: "key requests are signed only for a persona whose keys come off the root phrase (D-FID-5-LIVE-KEYSTORE-ONLY)" };
  const pub = fcSignerPublicKeyFor(personaId);
  const addr = fcCustodyAddressFor(personaId);
  if (!pub || !addr) return { refused: true, reason: "not one of this device's personas — no signer key" };
  if (!Number.isInteger(input.requestFid) || input.requestFid <= 0) return { refused: true, reason: "requestFid malformed" };
  if (!Number.isInteger(input.deadline) || input.deadline < nowSec() || input.deadline > nowSec() + 3600) return { refused: true, reason: "deadline malformed, past, or more than an hour out" };
  const key = "0x" + pub;
  const signature = await signCustodyTypedDataFor(personaId, {
    domain: SIGNED_KEY_REQUEST_DOMAIN,
    types: SIGNED_KEY_REQUEST_TYPES,
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(input.requestFid), key, deadline: BigInt(input.deadline) },
  });
  if (!signature) return { refused: true, reason: "custody key unavailable" };
  return { signature, key, address: addr };
}
