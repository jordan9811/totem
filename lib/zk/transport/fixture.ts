import "server-only";
// ZK PASS 1 — the FIXTURE transport: a real computation in a toy scheme.
//
// The "proof" is a deterministic tag
//   sha256("layers-zk-fixture/1" | canonical(publicInputs) | nullifier | FIXTURE_TAG_KEY)
// and the nullifier is the REAL formula over the REAL secret
// (Poseidon(hash(scope), secretScalar)), so scope semantics, budget
// accounting, replay detection and root checks are exercised exactly as
// live would exercise them. What the fixture scheme deliberately has NONE
// of is soundness: FIXTURE_TAG_KEY is a public constant, so anyone can mint
// a tag. That is the point — fixture proves the PLUMBING and every refusal
// path, never security; the report says so in plain words. It is a
// separate universe (mode:"fixture") that no live verifier accepts.
//
// The validator holds a byte-identical duplicate of the tag function
// (validator/zk.js) — the Gate 0 suite pins them together.
//
// PERSONA LAUNCH P7: the computation moved to ./fixtureCore.ts (pure: the secret is passed in), so the browser's Web
// Worker prover runs the SAME code the server-side device runs. This module keeps its exports and its behaviour: it
// reads this root's commitment and secret scalar from the identity module and hands them to the core.
import { zkSecretScalarForProver } from "../identity";
import { FIXTURE_TAG_KEY, NOT_A_MEMBER, fixturePrecheck, fixtureProveCore, fixtureTag, fixtureVerifyCore } from "./fixtureCore";
import type { ClaimKind, FixtureProofBody, ProofEnvelope, PublicInputs, VerifyResult, WitnessRef, ZkTransport } from "./types";

export { FIXTURE_TAG_KEY, fixtureTag };

export const fixtureTransport: ZkTransport = {
  mode: "fixture",

  async prove(claimKind: ClaimKind, publicInputs: PublicInputs, witness: WitnessRef): Promise<ProofEnvelope> {
    // The witness is consulted exactly as live would: the prover must hold
    // a leaf in the tree it claims. (Fixture cannot make that unforgeable;
    // it can make the honest path require it.)
    fixturePrecheck(claimKind, publicInputs);
    const { zkCommitment } = await import("../identity");
    const commitment = zkCommitment();
    if (!witness.members.includes(commitment)) throw new Error(NOT_A_MEMBER);
    const { nullifier, tag } = fixtureProveCore(claimKind, publicInputs, witness.members, commitment, zkSecretScalarForProver());
    const body: FixtureProofBody = { scheme: "layers-zk-fixture/1", tag };
    return { v: 1, mode: "fixture", claimKind, publicInputs, nullifier, proof: body };
  },

  async verify(claimKind: ClaimKind, envelope: ProofEnvelope): Promise<VerifyResult> {
    return fixtureVerifyCore(claimKind, envelope);
  },
};
