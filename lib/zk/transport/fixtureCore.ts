// PERSONA LAUNCH P7 — THE FIXTURE SCHEME'S PURE CORE, shared by the node fixture transport (fixture.ts, which delegates
// here and keeps its exports) and the browser's Web Worker prover (lib/zk/prover/browser-worker.ts).
//
// Why a separate module: the worker bundle (public/device/prover.js) must not pull in the device's world — no keystore,
// no identity module, no "server-only" chain, no Buffer. So everything the fixture scheme computes is here as a function
// of what the caller PASSES: the public inputs, the tree's members, this root's public commitment and its secret scalar.
// The worker never reads a keystore; the device hands it the scalar for one job (lib/zk/transport/browser.ts).
//
// The scheme itself is unchanged (see fixture.ts): the "proof" is a deterministic tag
//   sha256("layers-zk-fixture/1" | canonical(publicInputs) | nullifier | FIXTURE_TAG_KEY)
// over the REAL nullifier Poseidon(2)([semaphoreHash(scope), secret]) — the circuit's formula, a DELIBERATE DUPLICATE of
// lib/zk/nullifier.ts that imports poseidon2 from its own entry point ("poseidon-lite/poseidon2") so the worker bundle
// carries one round-constant table, not sixteen. scripts/unit-prover.mjs pins fixtureTag to validator/zk.js and the
// nullifier to lib/zk/nullifier.ts; accept-z0 pins the validator to its own duplicate.
import { sha256 } from "@noble/hashes/sha2";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { parseField, semaphoreHash } from "../hash";
import { canonicalPublicInputs, isClaimKind, type ClaimKind, type FixtureProofBody, type ProofEnvelope, type PublicInputs, type VerifyResult } from "./types";

export const FIXTURE_TAG_KEY = "layers-zk-fixture-tag/v1";

const te = new TextEncoder();
const HEX = "0123456789abcdef";
const toHex = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
};

export function fixtureTag(canonical: string, nullifier: string): string {
  return toHex(sha256(te.encode(["layers-zk-fixture/1", canonical, nullifier, FIXTURE_TAG_KEY].join("|"))));
}

/** the circuit's nullifier: Poseidon(2)([semaphoreHash(scope), secret]) — lib/zk/nullifier.ts, duplicated (header) */
export function fixtureNullifier(scope: bigint, secretScalar: bigint): bigint {
  return poseidon2([semaphoreHash(scope), secretScalar]);
}

/**
 * The fixture prove, as a pure function. Refuses (throws) exactly where fixture.ts always refused: another universe, an
 * unknown or mismatched claim kind, a scope or message that is not a field element, and a root whose commitment is not a
 * member of the tree it claims (fixture cannot make membership unforgeable; it makes the honest path require it).
 */
/** the refusals that need nothing secret, in fixture.ts's original order (universe, kind, scope, message); returns the scope */
export function fixturePrecheck(claimKind: ClaimKind, publicInputs: PublicInputs): bigint {
  if (publicInputs?.mode !== "fixture") throw new Error("fixture transport: refusing to prove a non-fixture envelope");
  if (!isClaimKind(claimKind) || publicInputs.claimKind !== claimKind) throw new Error("fixture transport: unknown claim kind");
  const scope = parseField(publicInputs.scope);
  if (scope === null) throw new Error("fixture transport: scope is not a field element");
  if (parseField(publicInputs.message) === null) throw new Error("fixture transport: message is not a field element");
  return scope;
}

export const NOT_A_MEMBER = "fixture transport: this root's commitment is not a member of the tree — cannot prove membership";

export function fixtureProveCore(claimKind: ClaimKind, publicInputs: PublicInputs, members: string[], commitment: string, secretScalar: bigint): { nullifier: string; tag: string } {
  const scope = fixturePrecheck(claimKind, publicInputs);
  if (!Array.isArray(members) || !members.includes(commitment)) throw new Error(NOT_A_MEMBER);
  if (typeof secretScalar !== "bigint") throw new Error("fixture transport: no secret scalar");
  const nullifier = fixtureNullifier(scope, secretScalar).toString(10);
  return { nullifier, tag: fixtureTag(canonicalPublicInputs(publicInputs), nullifier) };
}

/** The fixture verify, as a pure function (no secret: anyone can check a tag — that is the scheme's whole point). */
export function fixtureVerifyCore(claimKind: ClaimKind, envelope: ProofEnvelope): VerifyResult {
  if (envelope?.mode !== "fixture" || envelope.publicInputs?.mode !== "fixture") {
    return { ok: false, code: "MODE", reason: "not a fixture-universe envelope" };
  }
  if (!isClaimKind(claimKind) || envelope.claimKind !== claimKind || envelope.publicInputs.claimKind !== claimKind) {
    return { ok: false, code: "KIND", reason: "unknown or mismatched claim kind" }; // fail closed
  }
  const body = envelope.proof as FixtureProofBody;
  if (body?.scheme !== "layers-zk-fixture/1" || typeof body.tag !== "string") {
    return { ok: false, code: "MALFORMED", reason: "malformed fixture proof body" };
  }
  if (parseField(envelope.nullifier) === null) return { ok: false, code: "MALFORMED", reason: "nullifier is not a field element" };
  const expected = fixtureTag(canonicalPublicInputs(envelope.publicInputs), envelope.nullifier);
  if (expected !== body.tag) return { ok: false, code: "TAMPER", reason: "tag does not match the public inputs (tampered signals)" };
  return { ok: true };
}
