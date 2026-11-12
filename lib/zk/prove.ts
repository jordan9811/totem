import "server-only";
// ZK PASS 1 — THE CLIENT-SIDE PROVE PIPELINE, in the only order that is
// safe. Every step is a refusal point; nothing downstream runs after one:
//
//   1. persona      — one of THIS root's personas; a well-formed gate id
//   2. epoch        — from the validator (single clock; never wall-clock),
//                     and its LENGTH must clear the client's minimum
//                     (attack-3 F-12: the grain was an operator knob)
//   3. members      — the tree's public leaves, so the Merkle path is
//                     derived LOCALLY (never "give me my path")
//   4. ROOT GATE    — the root is in the SIGNED history the client
//                     cross-checks against its DEVICE anchor (F8); a root
//                     outside it → refuse to prove
//   5. COHORT       — the leaves rebuild to that root, they clear the
//                     CLIENT's anonymity floor, and the cohort has not
//                     rotated past the continuity limit since this client
//                     last proved into it (attack-3 F-1/F-2, attack-2 #8)
//   6. membership   — our commitment is a leaf THIS epoch (batched
//                     registration means "not yet" is normal)
//   7. BUDGET       — a distinct-PARTITION slot for (persona, epoch),
//                     reserved on the device BEFORE proving (C3/F2b)
//   8. scope/msg    — from the frozen registry + the fixed binding (the
//                     validator re-derives both and refuses anything else)
//   9. prove        — fixture or live transport
//  10. SELF-VERIFY  — against the pinned vkey; a failing proof never leaves
//
// PRECOMPUTE-ONLY: this function is called at idle by the queue (Gate 1)
// or by a suite. It is never called from a persona action handler, and
// there is no interactive prove path anywhere.
import { ZK_EPOCH_MIN_MS, zkMode, type ZkMode } from "./config";
import { isOwnPersona } from "@/lib/identity/keystore";
import { SEED_VIEWER } from "@/lib/adapters/mock/store";
import { predicateOf, reserveBudget, type BudgetStatus } from "./budget";
import { checkCohort, type CohortVerdict } from "./cohort";
import { fieldOf, fieldToString } from "./hash";
import { zkCommitment } from "./identity";
import { anonFidTreeCommitment, anonMembershipFor } from "./anon/fcJoin";
import { verifyRootAgainstHistory, verifyRootAgainstHistoryWith } from "./rootHistory";
import type { PrefetchSnapshot } from "./prefetch";
import { scopeString } from "./scopes";
import { transportFor } from "./transport";
import type { ClaimKind, ProofEnvelope, PublicInputs } from "./transport/types";
import { fetchEpoch, fetchMembers } from "./validatorClient";
import { attestQualifier, attestTreeName, validBucket, validIssuer } from "@/lib/attest/ids";
import { intersectionFor, setIntersection } from "./localPins";
import { ZK_ANON_FLOOR, ZK_ANON_POST_SLOTS, ZK_ANON_POST_TREE, ZK_REACH_FLOOR, ZK_X_ANON_POST_SLOTS, anonPostWindowOf } from "./config";
import { slotQualifier, xSlotQualifier } from "./anon/slots";
import { isAllowedAnonTree, parseReachTree } from "@/lib/reach/trees";

/** claimKind → scope registry entry. A gate proves under exactly one
 * registered scope; the mapping is fixed here, not by callers. */
const SCOPE_FOR_CLAIM: Record<ClaimKind, string> = {
  "tier-membership": "discovery-tier",
  "fork-continuity": "fork-continuity",
  attestation: "attestation",
  "anon-post": "anon-post",
  "persona-launch": "persona-launch",
  "x-anon-post": "x-anon-post",
};
/** PERSONA LAUNCH P5: the anon trees this CLIENT will prove into — the configured plain tree, or a known reach tree
 * (lib/reach/trees.ts). The validator keeps its own list (validator/zk.js anonTreeAllowed); neither trusts the other's. */
export function anonTreeAllowed(tree: string): boolean {
  return isAllowedAnonTree(tree, ZK_ANON_POST_TREE);
}
const FORK_COMMIT_RE = /^[0-9a-f]{64}$/;
/** MULTI-FID Gate 4: the constant the anon-post signal carries where a persona id would be */
export const ANON_PERSONA = "anon";

export interface ProveRequest {
  claimKind: ClaimKind;
  tree: string;
  personaId: string;
  gateId: string;
  mode?: ZkMode;
  /** Gate 3: fork-continuity — the fork commitment the message binds */
  forkCommit?: string;
  /** Gate 3: attestation — the issuer (tree must be attest:<issuer>/<bucket>) */
  issuer?: string;
  /** Attestation pass Gate 1: attestation — the bucket */
  bucket?: string;
  /** MULTI-FID Gate 4: anon-post — sha256("layers-anon-cast/1|" + text), 64 hex */
  castHash?: string;
  /** anon-post — the reveal-later commitment (sha256 of a secret only this device holds), 64 hex */
  attributionCommitment?: string;
  /** PERSONA LAUNCH P3 — anon-post only: the slot this post spends (0..K-1, the client's OWN K), assigned by the tick
   * from its snapshot (lib/zk/gate.ts runWantedProofs) */
  slot?: number;
  /** PERSONA LAUNCH P4 — anon-post only, REQUIRED: sha256 over the raw 256 bytes of the ring note the payload carries */
  noteHash?: string;
  /** PERSONA LAUNCH P6 — persona-launch only, REQUIRED: the commitment over the launch request (64 hex) */
  launchCommit?: string;
  /** PERSONA LAUNCH P8 — x-anon-post only, REQUIRED: the X copy's hash (64 hex); `slot` is then its X slot (0..K_X-1) */
  xHash?: string;
}

export type ProveStage = "persona" | "epoch" | "members" | "root" | "cohort" | "membership" | "budget" | "scope" | "prove" | "verify";
export type ProveOutcome =
  | { ok: true; envelope: ProofEnvelope; epoch: number; budget: BudgetStatus; cohort: CohortVerdict }
  | { ok: false; stage: ProveStage; reason: string };

export async function prepareAndProve(req: ProveRequest, snapshot?: PrefetchSnapshot | null): Promise<ProveOutcome> {
  const mode = req.mode ?? zkMode();
  // THE PRODUCT PATH PROVES FROM THE PREFETCH SNAPSHOT (Pass 2 Gate 0): no
  // fetch below runs when a snapshot for this universe and tree is given.
  const snap = snapshot && snapshot.mode === mode && snapshot.tree === req.tree ? snapshot : null;
  // The persona must be one of THIS root's (keystore-minted, or a seeded
  // viewer persona in the fixture world). Proving "my root authorizes P"
  // for a P we do not own would be a lie the circuit cannot detect.
  // MULTI-FID Gate 4: an anon post names NO persona — the signal carries the constant "anon", the
  // root's own identity proves, and the scope omits the persona (one per root per window)
  // PERSONA LAUNCH P4/P6: the kind-specific inputs are refused on every OTHER kind first — a note hash or a launch
  // commitment riding a claim that does not bind it would be a value the message never covers
  if (req.claimKind !== "anon-post" && req.noteHash !== undefined) return { ok: false, stage: "scope", reason: "a note hash is only valid on an anon post" };
  if (req.claimKind !== "persona-launch" && req.launchCommit !== undefined) return { ok: false, stage: "scope", reason: "a launch commitment is only valid on a launch request" };
  // PERSONA LAUNCH P8: an X hash rides only an X copy (the message binds it nowhere else)
  if (req.claimKind !== "x-anon-post" && req.xHash !== undefined) return { ok: false, stage: "scope", reason: "an X hash is only valid on an X copy" };
  if (req.claimKind === "anon-post") {
    if (req.personaId !== ANON_PERSONA) return { ok: false, stage: "persona", reason: "an anon post carries the constant 'anon', never a persona id" };
    if (!FORK_COMMIT_RE.test(req.castHash ?? "")) return { ok: false, stage: "scope", reason: "anon-post needs a 64-hex cast hash" };
    if (!FORK_COMMIT_RE.test(req.attributionCommitment ?? "")) return { ok: false, stage: "scope", reason: "anon-post needs a 64-hex attribution commitment" };
    // PERSONA LAUNCH P4 (R8): every anon post binds its ring note's hash — real or random, never absent
    if (!FORK_COMMIT_RE.test(req.noteHash ?? "")) return { ok: false, stage: "scope", reason: "anon-post needs a 64-hex note hash" };
    // PERSONA LAUNCH P5: the plain anon tree or a known reach tree — nothing else (the scope never carries the tree)
    if (!anonTreeAllowed(req.tree)) return { ok: false, stage: "scope", reason: `anon posts prove membership in ${ZK_ANON_POST_TREE} or a reach tier, not ${req.tree}` };
    // PERSONA LAUNCH P3: one nullifier per (person, window, SLOT) — the slot must be one of the client's own K
    if (!Number.isInteger(req.slot) || (req.slot as number) < 0 || (req.slot as number) >= ZK_ANON_POST_SLOTS) return { ok: false, stage: "scope", reason: `anon-post needs a slot from 0 to ${ZK_ANON_POST_SLOTS - 1}` };
  } else if (req.claimKind === "persona-launch") {
    // PERSONA LAUNCH P6: the launch request names no persona (the constant 'anon'), proves the plain anon tree, takes
    // no slot (one per person per window) and binds the request's commitment
    if (req.personaId !== ANON_PERSONA) return { ok: false, stage: "persona", reason: "a launch request carries the constant 'anon', never a persona id" };
    if (req.tree !== ZK_ANON_POST_TREE) return { ok: false, stage: "scope", reason: `a launch request proves membership in ${ZK_ANON_POST_TREE}, not ${req.tree}` };
    if (!FORK_COMMIT_RE.test(req.launchCommit ?? "")) return { ok: false, stage: "scope", reason: "a launch request needs a 64-hex launch commitment" };
    if (req.slot !== undefined) return { ok: false, stage: "scope", reason: "a launch request takes no slot (one per person per window)" };
  } else if (req.claimKind === "x-anon-post") {
    // PERSONA LAUNCH P8: the anonymous X copy names no persona (the constant 'anon'), proves the PLAIN anon tree only (an
    // X copy carries no boost: a reach tree is refused here as on the validator), binds its xHash, and spends an X slot
    // 0..K_X-1 (the client's OWN K_X); the anon-post fields are not its own
    if (req.personaId !== ANON_PERSONA) return { ok: false, stage: "persona", reason: "an X copy carries the constant 'anon', never a persona id" };
    if (req.tree !== ZK_ANON_POST_TREE) return { ok: false, stage: "scope", reason: `an X copy proves membership in ${ZK_ANON_POST_TREE}, the plain anon tree, not ${req.tree} — X carries no boost` };
    if (!FORK_COMMIT_RE.test(req.xHash ?? "")) return { ok: false, stage: "scope", reason: "an X copy needs a 64-hex X hash" };
    if (req.castHash !== undefined || req.attributionCommitment !== undefined) return { ok: false, stage: "scope", reason: "an X copy binds its own X hash, not a cast hash or a reveal commitment" };
    if (!Number.isInteger(req.slot) || (req.slot as number) < 0 || (req.slot as number) >= ZK_X_ANON_POST_SLOTS) return { ok: false, stage: "scope", reason: `an X copy needs an X slot from 0 to ${ZK_X_ANON_POST_SLOTS - 1}` };
  } else if (req.slot !== undefined) {
    return { ok: false, stage: "scope", reason: "a slot is only valid on an anon post" };
  } else if (req.personaId === ANON_PERSONA) {
    return { ok: false, stage: "persona", reason: "'anon' is reserved for anon posts" };
  } else if (!isOwnPersona(req.personaId) && !SEED_VIEWER.personas.includes(req.personaId)) {
    return { ok: false, stage: "persona", reason: "personaId is not one of this root's personas" };
  }
  // gateId grammar widened for attestation gates ("attest:<issuer>/<bucket>"); the validator agrees
  if (!/^[A-Za-z0-9_.:\/-]{1,96}$/.test(req.gateId)) return { ok: false, stage: "persona", reason: "gateId malformed" };
  if (req.claimKind === "attestation" && (!validIssuer(req.issuer) || !validBucket(req.bucket) || req.tree !== attestTreeName(req.issuer, req.bucket))) {
    return { ok: false, stage: "scope", reason: "attestation needs an issuer and a bucket, and the tree attest:<issuer>/<bucket>" };
  }
  const transport = await transportFor(mode);

  let epoch: number;
  try {
    const ep = snap ? snap.epoch : await fetchEpoch(mode);
    epoch = ep.epoch;
    if (!Number.isInteger(epoch) || epoch < 0) return { ok: false, stage: "epoch", reason: "validator epoch is not a non-negative integer" };
    if (!Number.isFinite(ep.epochMs) || ep.epochMs < ZK_EPOCH_MIN_MS) {
      return { ok: false, stage: "epoch", reason: `validator epoch length ${ep.epochMs} ms is below the client minimum ${ZK_EPOCH_MIN_MS} ms — refusing a finer presence grain` };
    }
  } catch (e) {
    return { ok: false, stage: "epoch", reason: (e as Error).message };
  }

  let members: Awaited<ReturnType<typeof fetchMembers>>;
  try {
    members = snap ? snap.members : await fetchMembers(mode, req.tree);
  } catch (e) {
    return { ok: false, stage: "members", reason: (e as Error).message };
  }
  if (members.epoch !== epoch) return { ok: false, stage: "root", reason: "epoch advanced during preparation — retry next idle" };
  if (!Array.isArray(members.members) || !members.members.every((m) => typeof m === "string" && /^(0|[1-9][0-9]{0,76})$/.test(m))) {
    return { ok: false, stage: "members", reason: "served member list is not a list of canonical field elements" };
  }

  let rootCheck: Awaited<ReturnType<typeof verifyRootAgainstHistory>>;
  try {
    if (snap) {
      if (snap.history.pubkey !== snap.validatorKey) return { ok: false, stage: "root", reason: "snapshot: history endpoint reported a different key than the key endpoint" };
      rootCheck = verifyRootAgainstHistoryWith(mode, req.tree, members.root, { pubkey: snap.validatorKey, entries: snap.history.entries, anonHead: snap.anonHead, anonHeadError: snap.anonHeadError });
    } else {
      rootCheck = await verifyRootAgainstHistory(mode, req.tree, members.root);
    }
  } catch (e) {
    return { ok: false, stage: "root", reason: (e as Error).message };
  }
  if (!rootCheck.ok) return { ok: false, stage: "root", reason: rootCheck.reason ?? "root refused" };

  let cohort: CohortVerdict;
  try {
    cohort = checkCohort(mode, req.tree, epoch, members.root, members.members);
  } catch (e) {
    return { ok: false, stage: "cohort", reason: (e as Error).message };
  }
  if (!cohort.ok) return { ok: false, stage: "cohort", reason: cohort.reason ?? "cohort refused" };
  // PERSONA LAUNCH P5 (R6): a REACH tree carries its own crowd floor (ZK_REACH_FLOOR, never below ZK_ANON_FLOOR): an
  // owner service that runs ZK_ANON_FLOOR=1 for its plain anonymous account still never proves into a reach tier of one
  if (req.claimKind === "anon-post" && parseReachTree(req.tree) && members.members.length < ZK_REACH_FLOOR) {
    return { ok: false, stage: "cohort", reason: `the ${req.tree} tier has ${members.members.length} accounts, below the reach floor ${ZK_REACH_FLOOR} — not proved into (the post waits; it is never boosted into a crowd that small)` };
  }

  // Gate 4 (attack-att-1 #2, attack-att-3 #3): the RUNNING INTERSECTION of every attestation
  // tree this persona has proven into, across epochs, must stay above the floor — the per-tree
  // floor and the per-epoch budget do not bound what an operator learns by intersecting.
  if (req.claimKind === "attestation") {
    const prev = intersectionFor(mode, req.personaId);
    const cur = new Set(members.members);
    const next = prev === null ? members.members : prev.filter((m) => cur.has(m));
    if (next.length < ZK_ANON_FLOOR) {
      return { ok: false, stage: "cohort", reason: `proving ${req.tree} would shrink this persona's running intersection of proven buckets to ${next.length} < the floor ${ZK_ANON_FLOOR} — refused (fail closed)` };
    }
    setIntersection(mode, req.personaId, next);
  }
  // PUBLIC GO-LIVE (PRIV-LIVE-1): WHICH identity proves this tree. The live universe's plain anon tree, on a validator whose
  // fid gate is on, is proved by this device's CROWD identity (lib/zk/anon/fcJoin.ts: never registered under a root, joined
  // with a verified Sign in with Farcaster) and never by the root's; every other tree is the root identity's, as before.
  // The transport picks the same identity from the same members (lib/zk/transport/browser.ts proverIdentityFor).
  // (the gate is read off the tick's snapshot — the anon config rides every snapshot of a tick, whatever its tree; never a
  // fetch, and no import of the prefetch module here. No snapshot at all — a direct, non-product call — reads as "not said":
  // the root when it is the leaf, else the crowd identity when it is)
  const fidGate = (snap ?? (snapshot && snapshot.mode === mode ? snapshot : null))?.anonConfig?.fidGate;
  const membership = anonMembershipFor({ mode, tree: req.tree, plainTree: ZK_ANON_POST_TREE, members: members.members, fidGate, rootCommitment: zkCommitment(), fidCommitment: anonFidTreeCommitment });
  if (!membership.ok) return { ok: false, stage: "membership", reason: membership.reason };

  let budget: ReturnType<typeof reserveBudget>;
  try {
    budget = reserveBudget(mode, req.personaId, epoch, predicateOf(req.claimKind, req.tree, req.gateId));
  } catch (e) {
    // a device-pins write failure is a refusal, never an escape (fail closed)
    return { ok: false, stage: "budget", reason: "budget could not be recorded on the device: " + (e as Error).message };
  }
  if (!budget.ok) return { ok: false, stage: "budget", reason: budget.reason };

  let scope: string;
  try {
    scope = fieldToString(
      fieldOf(
        "scope",
        req.claimKind === "anon-post"
          ? scopeString("anon-post", epoch, undefined, slotQualifier(anonPostWindowOf(epoch), req.slot as number)) // no persona, NO TREE: one per person per (window, slot)
          : req.claimKind === "persona-launch"
            ? scopeString("persona-launch", epoch, undefined, anonPostWindowOf(epoch)) // no persona, no slot, no tree: one per person per window
            : req.claimKind === "x-anon-post"
              ? scopeString("x-anon-post", epoch, undefined, xSlotQualifier(anonPostWindowOf(epoch), req.slot as number)) // PERSONA LAUNCH P8: no persona, no tree: one per person per (window, X slot)
              : scopeString(SCOPE_FOR_CLAIM[req.claimKind], epoch, req.personaId, req.claimKind === "attestation" ? attestQualifier(req.issuer as string, req.bucket as string) : undefined)
      )
    );
  } catch (e) {
    return { ok: false, stage: "scope", reason: (e as Error).message };
  }
  // The challenge is epoch-bound and derived locally: asking the validator
  // for a challenge would be a "I am about to prove" signal it could
  // correlate. Replay across epochs fails on the epoch component and on
  // the stale-root grace bound. (The preparation traffic above IS
  // identified — SECURITY-POSTURE.md A-PREPARE-BURST.)
  const challenge = `epoch-${epoch}`;
  // Gate 3: what the claim is ABOUT rides the message, per kind
  // (DELIBERATE DUPLICATE of validator/zk.js expectedPublicValues):
  //   tier-membership : personaId | gateId | challenge | root
  //   fork-continuity : personaId | gateId | fork:<forkCommit> | challenge | root
  //   attestation     : personaId | gateId | attest:<issuer>/<bucket> | challenge | root
  let messageParts: string[];
  if (req.claimKind === "fork-continuity") {
    if (!FORK_COMMIT_RE.test(req.forkCommit ?? "")) return { ok: false, stage: "scope", reason: "fork-continuity needs a 64-hex fork commitment" };
    messageParts = [req.personaId, req.gateId, "fork:" + req.forkCommit, challenge, members.root];
  } else if (req.claimKind === "attestation") {
    messageParts = [req.personaId, req.gateId, req.tree, challenge, members.root];
  } else if (req.claimKind === "anon-post") {
    //   anon-post        : anon | gateId | cast:<castHash> | attr:<attributionCommitment> | note:<noteHash> | challenge | root
    // (PERSONA LAUNCH P4: the ring note's hash beside the reveal commitment — DELIBERATE DUPLICATE of validator/zk.js)
    messageParts = [ANON_PERSONA, req.gateId, "cast:" + req.castHash, "attr:" + req.attributionCommitment, "note:" + req.noteHash, challenge, members.root];
  } else if (req.claimKind === "persona-launch") {
    //   persona-launch   : anon | persona-launch | launch:<launchCommit> | challenge | root   (PERSONA LAUNCH P6)
    messageParts = [ANON_PERSONA, "persona-launch", "launch:" + req.launchCommit, challenge, members.root];
  } else if (req.claimKind === "x-anon-post") {
    //   x-anon-post      : anon | x-anon-post | x:<xHash> | challenge | root   (PERSONA LAUNCH P8 — DELIBERATE DUPLICATE of validator/zk.js)
    messageParts = [ANON_PERSONA, "x-anon-post", "x:" + req.xHash, challenge, members.root];
  } else {
    messageParts = [req.personaId, req.gateId, challenge, members.root];
  }
  const message = fieldToString(fieldOf("message", messageParts.join("|")));

  const publicInputs: PublicInputs = {
    mode,
    claimKind: req.claimKind,
    tree: req.tree,
    epoch,
    merkleTreeRoot: members.root,
    scope,
    message,
    personaId: req.personaId,
    gateId: req.gateId,
    challenge,
    ...(req.claimKind === "fork-continuity" ? { forkCommit: req.forkCommit } : {}),
    ...(req.claimKind === "attestation" ? { issuer: req.issuer, bucket: req.bucket } : {}),
    ...(req.claimKind === "anon-post" ? { castHash: req.castHash, attributionCommitment: req.attributionCommitment, slot: req.slot, noteHash: req.noteHash } : {}),
    ...(req.claimKind === "persona-launch" ? { launchCommit: req.launchCommit } : {}),
    ...(req.claimKind === "x-anon-post" ? { xHash: req.xHash, slot: req.slot } : {}),
  };

  let envelope: ProofEnvelope;
  try {
    // PUBLIC GO-LIVE (PRIV-LIVE-1): the identity chosen at step 6 rides the witness (the in-tab transport proves with it;
    // a transport that predates it reads the members alone, as before)
    const witness: { members: string[]; identity: "root" | "anon-fid-tree" } = { members: members.members, identity: membership.identity };
    envelope = await transport.prove(req.claimKind, publicInputs, witness);
  } catch (e) {
    return { ok: false, stage: "prove", reason: (e as Error).message };
  }
  const v = await transport.verify(req.claimKind, envelope);
  if (!v.ok) return { ok: false, stage: "verify", reason: `self-verification failed: ${v.reason}` };
  return { ok: true, envelope, epoch, budget: budget.status, cohort };
}
