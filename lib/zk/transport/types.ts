// ZK PASS 1 — THE ZkTransport SEAM.
//
//   prove(claimKind, publicInputs, witnessRef)  →  ProofEnvelope
//   verify(claimKind, envelope)                 →  VerifyResult
//
// Two implementations behind it. FIXTURE: a real computation in a toy
// scheme — a deterministic tag over the canonical public inputs plus the
// REAL nullifier formula — never a `valid: true` literal, preserving every
// failure mode (tampered signals fail, wrong root fails, replayed
// nullifier 409s, unknown kind fails closed). LIVE: stock Semaphore v4 in
// a worker, verified locally against the build-pinned vkey before anything
// is submitted. Sweeps run fixture; only live-z* scripts run live.
//
// UNIVERSE-SCOPED: `mode` rides every envelope, every nullifier record,
// every tree root. A fixture envelope is never accepted by a live verifier
// and vice versa — that is checked before anything else.
import type { ZkMode } from "../config";

/** The claim kinds this pass knows. Adding one is a reviewed change (it is
 * also a new entry in the proof-history budget's universe). */
// PERSONA LAUNCH P6 (the launch track's seam, landed by reach in wave 2 step 1): "persona-launch" — one anonymous launch
// request per person per window (scope persona-launch/w<n>, onePerHuman, no slot, no persona, no tree beyond the plain
// anon tree). DELIBERATE DUPLICATE of CLAIM_KINDS in validator/zk.js.
// PERSONA LAUNCH P8: "x-anon-post" — an anonymous copy for the @totem X outbox (validator/xoutbox.js): the plain anon
// tree, its OWN slot (scope x-anon-post/w<n>/s<i>, i < K_X), the message binds x:<xHash>. DELIBERATE DUPLICATE as above.
export type ClaimKind = "tier-membership" | "fork-continuity" | "attestation" | "anon-post" | "persona-launch" | "x-anon-post";
export const CLAIM_KINDS: ReadonlyArray<ClaimKind> = Object.freeze(["tier-membership", "fork-continuity", "attestation", "anon-post", "persona-launch", "x-anon-post"]);

export function isClaimKind(x: unknown): x is ClaimKind {
  return typeof x === "string" && (CLAIM_KINDS as ReadonlyArray<string>).includes(x);
}

/** What the prover is told, and what the verifier sees. All public. */
export interface PublicInputs {
  mode: ZkMode;
  claimKind: ClaimKind;
  /** Gate 3 — fork-continuity only: sha256("layers-fork-commit/1|old|new|nonce")
   * as 64 hex; the OLD persona stays hidden behind it (the message binds it) */
  forkCommit?: string;
  /** Gate 3 — attestation only: the issuer whose attest:<issuer>/<bucket> tree is proven */
  issuer?: string;
  /** Attestation pass Gate 1 — attestation only: the BUCKET (the tree is attest:<issuer>/<bucket>) */
  bucket?: string;
  /** MULTI-FID Gate 4 — anon-post only: sha256("layers-anon-cast/1|" + text) as 64 hex; the message binds
   * it, the envelope's payload carries the text, the validator recomputes and refuses a mismatch */
  castHash?: string;
  /** MULTI-FID PASS — anon-post only: the reveal-later commitment, sha256 of a secret only this
   * device holds; bound into the message so it cannot be swapped after the proof is made */
  attributionCommitment?: string;
  /** PERSONA LAUNCH P3 — anon-post only: the SLOT this post spends, an integer 0..K-1. It qualifies the scope
   * (w<n>/s<i>: one nullifier per person, window and slot) and the fixture tag binds it; the validator rebuilds the scope
   * from it and stores it nowhere. Visible on the wire by design (A-ANON-SLOT-INDEX-VISIBLE). */
  slot?: number;
  /** PERSONA LAUNCH P4 (the ring note, R8) — anon-post only, REQUIRED there: sha256 over the RAW 256 bytes of the note
   * the payload carries (64 hex). Bound into the message beside attr: so nobody — the validator included — can swap one
   * post's note for another's; the validator recomputes it from payload.note and refuses a mismatch. */
  noteHash?: string;
  /** PERSONA LAUNCH P6 — persona-launch only: sha256 commitment (64 hex) over the launch request the payload carries;
   * the message binds it (launch:<commit>), the registrar recomputes it from the request (validator/registrar.js) */
  launchCommit?: string;
  /** PERSONA LAUNCH P8 — x-anon-post only: sha256("layers-x-anon/1|" + nonce + "|" + text) as 64 hex (domain-separated
   * from the cast hash, so an X copy's id never equals its Farcaster sibling's); the message binds x:<xHash>, the payload
   * carries { text, nonce }, the validator recomputes it and refuses a mismatch. `slot` is then the X slot (0..K_X-1). */
  xHash?: string;
  /** which validator tree ("tier-3", "valid", ...) */
  tree: string;
  epoch: number;
  /** the tree root the proof is built against — MUST be in the signed history */
  merkleTreeRoot: string;
  /** decimal field element: fieldOf("scope", scopeString) — see lib/zk/scopes.ts */
  scope: string;
  /** decimal field element: fieldOf("message", canonical) binding
   * personaId ‖ gateId ‖ challenge ‖ treeRoot */
  message: string;
  /** the persona this proof is FOR — in the clear by design (F2b), bounded
   * by the proof-history budget */
  personaId: string;
  gateId: string;
  challenge: string;
}

/** What the prover needs that is NOT public. Never serialized. */
export interface WitnessRef {
  /** the tree's members, so the Merkle path is derived LOCALLY (asking the
   * validator for "my path" would tell it which leaf asked) */
  members: string[];
}

export interface ProofEnvelope {
  v: 1;
  mode: ZkMode;
  claimKind: ClaimKind;
  publicInputs: PublicInputs;
  /** the nullifier — Poseidon(hash(scope), secret) in BOTH modes */
  nullifier: string;
  /** mode-specific proof body */
  proof: FixtureProofBody | LiveProofBody;
  /** MULTI-FID Gate 4 — anon-post only: the text the validator relays (bound by publicInputs.castHash), and (Gate 5) the
   * per-post nonce that salts the hash — two identical texts are two posts. PERSONA LAUNCH P4: and the 256-byte ring
   * note as 512 hex (bound by publicInputs.noteHash; real or random, the same size either way). PERSONA LAUNCH P6: a
   * persona-launch envelope carries exactly { request } instead (bound by publicInputs.launchCommit). */
  payload?: AnonPostPayload | LaunchPayload | XAnonPostPayload;
}

/** PERSONA LAUNCH P4: what an anon-post envelope carries — exactly these three keys (the validator refuses any other) */
export interface AnonPostPayload {
  text: string;
  nonce: string;
  /** 256 bytes as 512 lowercase hex: a ring note sealed for this persona's rings, or 256 random bytes */
  note: string;
}
/** PERSONA LAUNCH P6: what a persona-launch envelope carries — exactly { request } (≤ 2048 bytes; validator/registrar.js
 * validates it and commits to it) */
export interface LaunchPayload {
  request: string;
}
/** PERSONA LAUNCH P8: what an x-anon-post envelope carries — exactly { text, nonce } (bound by publicInputs.xHash; no ring
 * note: an X copy is never revealed by a launch) */
export interface XAnonPostPayload {
  text: string;
  nonce: string;
}

export interface FixtureProofBody {
  scheme: "layers-zk-fixture/1";
  tag: string;
}

export interface LiveProofBody {
  scheme: "semaphore-v4";
  merkleTreeDepth: number;
  points: string[];
}

export type VerifyResult = { ok: true } | { ok: false; reason: string; code: "MODE" | "KIND" | "TAMPER" | "MALFORMED" | "PIN" };

export interface ZkTransport {
  readonly mode: ZkMode;
  prove(claimKind: ClaimKind, publicInputs: PublicInputs, witness: WitnessRef): Promise<ProofEnvelope>;
  verify(claimKind: ClaimKind, envelope: ProofEnvelope): Promise<VerifyResult>;
}

/** One canonical serialization of the public inputs — what the fixture
 * tag covers and what both sides hash. Field order is fixed here. */
export function canonicalPublicInputs(p: PublicInputs): string {
  return [
    "layers-zk-public/1",
    p.mode,
    p.claimKind,
    p.tree,
    String(p.epoch),
    p.merkleTreeRoot,
    p.scope,
    p.message,
    p.personaId,
    p.gateId,
    p.challenge,
    // MULTI-FID Gate 4/PASS: the cast hash and its reveal commitment are part of the canonical signal
    // for an anon post (DELIBERATE DUPLICATE of validator/zk.js)
    // PERSONA LAUNCH P3: and the slot ("" when absent — never matches a tag made over a slot)
    // PERSONA LAUNCH P4: and the ring note's hash ("" when absent — the validator refuses an anon post without one)
    ...(p.claimKind === "anon-post" ? [p.castHash ?? "", p.attributionCommitment ?? "", p.slot === undefined || p.slot === null ? "" : String(p.slot), p.noteHash ?? ""] : []),
    // PERSONA LAUNCH P6: the launch commitment (DELIBERATE DUPLICATE of validator/zk.js canonicalPublicInputs and of the
    // decoy builders in scripts/accept-fid5.mjs and scripts/accept-linkage6.mjs)
    ...(p.claimKind === "persona-launch" ? [p.launchCommit ?? ""] : []),
    // PERSONA LAUNCH P8: the X copy's hash and its X slot ("" when absent). DELIBERATE DUPLICATE of validator/zk.js.
    ...(p.claimKind === "x-anon-post" ? [p.xHash ?? "", p.slot === undefined || p.slot === null ? "" : String(p.slot)] : []),
  ].join("|");
}
