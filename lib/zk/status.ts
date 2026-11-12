import "server-only";
// ZK PASS 1 — the account-level zk status the settings surface and the
// suites read. PUBLIC MATERIAL ONLY: the commitment, registration state,
// epoch, tree sizes vs the floor, whether our signed placement verifies
// against the DEVICE-PINNED validator key, the vkey pin check, the
// artifact cache check, the device pins summary (hashes/epochs/sizes).
// No secret, no rootId, no persona list, no budget addresses.
import { ZK_ANON_FLOOR, ZK_COHORT_MAX_CHURN, ZK_EPOCH_MIN_MS, ZK_PROOF_BUDGET, MERKLE_TREE_DEPTH, zkMode, type ZkMode } from "./config";
import { checkCachedArtifacts } from "./artifacts";
import { CEREMONY, checkVkeyPin } from "./ceremony";
import { zkCommitment, zkCommitmentDerivedTwiceIdentical, zkIdentityIndexNow, zkPendingIdentity } from "./identity";
import { pinnedValidatorKey, pinsSummary } from "./localPins";
import { prefetchStatus, type PrefetchStatus } from "./prefetch";
import { verifyPlacement } from "./rootHistory";
import { fetchEpoch, fetchPlacement, fetchTrees, fetchValidatorKey, type ZkTreeStatus } from "./validatorClient";
import { VALIDATOR_URL, ZK_JITTER_MAX_MS, ZK_JITTER_MIN_MS, ZK_POW_BITS } from "./config";
import { relayConfig, type RelayConfig } from "./anon/relay";
import { queueStatus, type QueueStatus } from "./anon/queue";

export interface ZkStatus {
  mode: ZkMode;
  depth: number;
  commitment: string;
  derivedTwiceIdentical: boolean;
  epoch: number | null;
  registration: { registered: boolean; epochRegistered: number | null; activeFromEpoch: number | null; activeNow: boolean; revokedFromEpoch: number | null } | null;
  /** Gate 3: the zk-identity branch this device is on (0 = original; bumped by re-issuance) */
  identityIndex: number;
  /** Gate 4: a re-issued branch waiting for its activation epoch (the old one keeps proving until then) */
  pendingIdentity: { index: number; activeFromEpoch: number } | null;
  /** the validator's view of its trees (public; its `floor`/`clearsFloor`
   * are the VALIDATOR's opinion and are never used by the label) */
  trees: ZkTreeStatus[];
  /** the CLIENT's floor — the one the prove path and the label enforce */
  floor: number;
  floorSource: "client";
  cohortMaxChurn: number;
  epochMinMs: number;
  placement: { tree: string; found: boolean; verified: boolean; keyPinned: boolean; servedKeyMatchesPin: boolean | null } | null;
  vkeyPin: ReturnType<typeof checkVkeyPin>;
  artifactsCached: { wasm: boolean; zkey: boolean } | null;
  budgetLimit: number;
  ceremony: typeof CEREMONY;
  validatorReachable: boolean;
  /** device-local pins: key pin, anchors, cohort records (public material) */
  pins: ReturnType<typeof pinsSummary>;
  /** Pass 2 Gate 0: the fixed-schedule prefetch (cadence, ticks, snapshot summary) */
  prefetch: PrefetchStatus;
  /** Gate 3: the computed verdict (also on GET /api/zk so suites read one shape) */
  privacy?: import("./privacy").PrivacyVerdict;
  /** Gate 1: the anonymous channel's configuration + queue */
  relay: RelayConfig;
  pow: { bits: number };
  jitter: { minMs: number; maxMs: number };
  queue: Pick<QueueStatus, "queued" | "sent" | "refused" | "nextDueInMs" | "persistPending">;
  error?: string;
}

async function registrationState(mode: ZkMode, commitment: string, epoch: number) {
  const res = await fetch(`${VALIDATOR_URL}/zk/registration?mode=${mode}&commitment=${encodeURIComponent(commitment)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`registration lookup HTTP ${res.status}`);
  const j = (await res.json()) as { registered: boolean; epochRegistered: number | null; activeFromEpoch: number | null; revokedFromEpoch?: number | null };
  const revokedFromEpoch = typeof j.revokedFromEpoch === "number" ? j.revokedFromEpoch : null;
  return {
    registered: j.registered === true,
    epochRegistered: j.epochRegistered ?? null,
    activeFromEpoch: j.activeFromEpoch ?? null,
    // Gate 3: a revoked registration is active until its revocation epoch
    activeNow: j.registered === true && typeof j.activeFromEpoch === "number" && j.activeFromEpoch <= epoch && (revokedFromEpoch === null || revokedFromEpoch > epoch),
    revokedFromEpoch,
  };
}

export async function zkStatus(mode: ZkMode = zkMode()): Promise<ZkStatus> {
  const commitment = zkCommitment();
  const base: ZkStatus = {
    mode,
    depth: MERKLE_TREE_DEPTH,
    commitment,
    identityIndex: zkIdentityIndexNow(),
    pendingIdentity: zkPendingIdentity(),
    derivedTwiceIdentical: zkCommitmentDerivedTwiceIdentical(),
    epoch: null,
    registration: null,
    trees: [],
    floor: ZK_ANON_FLOOR,
    floorSource: "client",
    cohortMaxChurn: ZK_COHORT_MAX_CHURN,
    epochMinMs: ZK_EPOCH_MIN_MS,
    placement: null,
    vkeyPin: checkVkeyPin(),
    artifactsCached: checkCachedArtifacts(MERKLE_TREE_DEPTH),
    budgetLimit: ZK_PROOF_BUDGET,
    ceremony: CEREMONY,
    validatorReachable: false,
    pins: pinsSummary(),
    prefetch: prefetchStatus(mode),
    relay: relayConfig(),
    pow: { bits: ZK_POW_BITS },
    jitter: { minMs: ZK_JITTER_MIN_MS, maxMs: ZK_JITTER_MAX_MS },
    queue: { queued: 0, sent: 0, refused: 0, nextDueInMs: null, persistPending: false },
  };
  try {
    const q = await queueStatus();
    base.queue = { queued: q.queued, sent: q.sent, refused: q.refused, nextDueInMs: q.nextDueInMs, persistPending: q.persistPending };
  } catch {
    /* queue unreadable: reported as empty, the error surfaces below if the validator is down */
  }
  try {
    const [{ epoch }, trees, servedKey] = await Promise.all([fetchEpoch(mode), fetchTrees(mode), fetchValidatorKey()]);
    base.epoch = epoch;
    base.trees = trees;
    base.validatorReachable = true;
    base.registration = await registrationState(mode, commitment, epoch);
    const placement = await fetchPlacement(mode, "valid", commitment);
    // attack-3 F-11: "verified" means verified against the key THIS DEVICE
    // pinned — never against the key served in the same breath.
    const pinned = pinnedValidatorKey();
    base.placement = {
      tree: "valid",
      found: placement !== null,
      verified: placement !== null && pinned !== null && verifyPlacement(placement, pinned),
      keyPinned: pinned !== null,
      servedKeyMatchesPin: pinned === null ? null : pinned === servedKey,
    };
  } catch (e) {
    base.error = (e as Error).message;
  }
  try {
    const { privacyConditions } = await import("./privacy");
    base.privacy = await privacyConditions(mode);
  } catch {
    /* the label is computed by its own component; an error here only omits the copy on status */
  }
  return base;
}
