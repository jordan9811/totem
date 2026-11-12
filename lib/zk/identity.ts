import "server-only";
// ZK PASS 1 — the root's Semaphore identity, CONFINED.
//
// zk master (keystore, HKDF "zk-identity/1")
//   → Identity (stock @semaphore-protocol/identity: EdDSA-Poseidon secret
//     scalar, BabyJubJub public key, commitment = Poseidon(2)(pubkey))
//
// What leaves this module: the COMMITMENT (public by design — it is what
// gets registered into the validator's trees) and booleans for probes.
// What never leaves: the master bytes, the secret scalar, the private key
// encoding. The one exception is zkSecretScalarForProver(), imported by
// the transport modules only, which hand it to the prover in-process
// (fixture: the real nullifier formula; live: the worker). It is never
// serialized, logged, or returned by a route — the leak grep hunts every
// encoding of it (zkMaterialForLeakTest).
//
// ONE identity per ROOT. There is deliberately no per-persona accessor.
import { Identity } from "@semaphore-protocol/identity";
import { rootHandle, setZkIdentityIndex, setZkIdentityPending, zkIdentityIndex, zkIdentityPending, zkMasterBytes, zkMasterBytesFromSeedHex } from "@/lib/identity/keystore";
import { anonFidTreeMaterialForLeakTest } from "./anon/fcJoin";

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// Cached per root: recovery / device-loss swap the keystore root, and a
// stale identity cached across that would silently prove as the OLD root.
let cached: { root: string; index: number; identity: Identity } | null = null;

function identity(): Identity {
  const root = rootHandle();
  const index = zkIdentityIndex();
  if (cached && cached.root === root && cached.index === index) return cached.identity;
  const id = new Identity(zkMasterBytes(index));
  cached = { root, index, identity: id };
  return id;
}

/** Gate 3: the identity branch this device is on (0 = original). */
export function zkIdentityIndexNow(): number {
  return zkIdentityIndex();
}

/** Gate 3: REVOCATION VIA EPOCH RE-ISSUANCE, device half — move to the
 * next identity branch. The caller revokes the current commitment on the
 * validator FIRST; the old branch is never proved with again. Returns the
 * NEW commitment. */
export function reissueZkIdentity(): { index: number; commitment: string } {
  const next = zkIdentityIndex() + 1;
  setZkIdentityIndex(next);
  cached = null;
  return { index: next, commitment: zkCommitment() };
}

/** The commitment at an explicit index (public) — the re-issuance registers
 * the NEXT branch's commitment before switching to it; the recovery scan
 * walks these against the validator's registration state. */
export function zkCommitmentAt(index: number): string {
  return new Identity(zkMasterBytes(index)).commitment.toString(10);
}

/** Gate 4 (attack-z2-2 #4): the pending re-issued branch, if any. */
export function zkPendingIdentity(): { index: number; activeFromEpoch: number } | null {
  return zkIdentityPending();
}
export function setZkPendingIdentity(index: number, activeFromEpoch: number): void {
  setZkIdentityPending({ index, activeFromEpoch });
}
/** Called by the prefetch tick with the epoch it saw: once the pending
 * branch's leaf is active, it becomes the proving identity. Never mid-epoch:
 * the old branch is a leaf exactly until then. */
export function promotePendingIdentity(epoch: number): boolean {
  const p = zkIdentityPending();
  if (!p || epoch < p.activeFromEpoch) return false;
  setZkIdentityIndex(p.index);
  cached = null;
  return true;
}

/** The public commitment C_root = Poseidon(pubkey) — decimal string. */
export function zkCommitment(): string {
  return identity().commitment.toString(10);
}

/** For probes: a FRESH derivation (bypassing the cache) must equal the
 * cached one — same seed, same commitment, twice. */
export function zkCommitmentDerivedTwiceIdentical(): boolean {
  const fresh = new Identity(zkMasterBytes()).commitment.toString(10);
  return fresh === zkCommitment();
}

/** What commitment WOULD an explicit seed produce — the recovery
 * determinism probe (phrase → seed → identical commitment) without
 * touching the live keystore. */
export function zkCommitmentFromSeedHex(seedHex: string): string {
  return new Identity(zkMasterBytesFromSeedHex(seedHex)).commitment.toString(10);
}

/**
 * CONFINED. Transport modules only. The secret scalar is the circuit's
 * `secret` input and the nullifier preimage half; it is the single most
 * sensitive value in the ZK layer (anyone holding it proves as this root
 * in every tree, forever — there is no rotation story, F9).
 */
export function zkSecretScalarForProver(): bigint {
  return identity().secretScalar;
}

/**
 * CONFINED. The live transport only: the master bytes, hex, handed to the
 * prover worker inside this same process (workerData). Never crosses a
 * network boundary, never serialized to a response.
 */
export function zkMasterHexForProver(): string {
  return toHex(zkMasterBytes());
}

/**
 * EVERY encoding of zk secret material the leak grep must hunt: the master
 * bytes, the secret scalar (decimal AND hex), and the identity's private
 * key export (base64) plus its hex. Any of these in an adapter response,
 * page payload, cookie, log line, or validator record is a failed gate.
 */
export function zkMaterialForLeakTest(): string[] {
  const id = identity();
  const master = zkMasterBytes();
  const scalar = id.secretScalar;
  const priv = id.privateKey;
  const privBytes = typeof priv === "string" ? Buffer.from(priv, "utf8") : Buffer.from(priv);
  return [
    toHex(master),
    scalar.toString(10),
    scalar.toString(16),
    id.export(), // base64 of the private key
    privBytes.toString("hex"),
    ...anonFidTreeMaterialForLeakTest(), // PUBLIC GO-LIVE (PRIV-LIVE-1): the crowd identity is key material too
  ];
}

/** Invalidate the cached identity (device loss / recovery / dev reset). */
export function resetZkIdentityCache(): void {
  cached = null;
}
