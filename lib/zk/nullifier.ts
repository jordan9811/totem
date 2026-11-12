// ZK PASS 1 — THE nullifier formula, taken from the audited circuit and
// nowhere else. From @semaphore-protocol/circuits@4.14.3/src/semaphore.circom
// (byte-identical to the ceremony commit 3521c96b…, see
// research/zk-ceremony-verification.json):
//
//     nullifier <== Poseidon(2)([scope, secret]);
//
// where `scope` is the circuit INPUT — i.e. semaphoreHash(scopeValue), not
// the raw scope value — and `secret` is the identity's secret scalar. The
// order is [scope, secret]; a swapped order is a different hash and a
// different, wrong nullifier.
//
// This lets the scope-collision test (the F2 safety-set item) assert on
// REAL nullifiers — the exact values a live proof would emit — without
// generating a proof: poseidon-lite is the same Poseidon implementation the
// identity package uses for commitments, pinned to Semaphore's own version.
// The live suite (live-z2) additionally asserts proof.nullifier equals this
// function's output for the same inputs, so the duplicate cannot drift
// silently.
import { poseidon2 } from "poseidon-lite";
import { semaphoreHash } from "./hash";

export function nullifierFor(scopeValue: bigint, secretScalar: bigint): bigint {
  return poseidon2([semaphoreHash(scopeValue), secretScalar]);
}
