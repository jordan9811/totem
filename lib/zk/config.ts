import { validatorUrl } from "@/lib/ports";
// ZK PASS 1 — configuration, read once, every knob named here.
//
// UNIVERSE: fixture vs live. The FC-pass lesson (a fixture write once
// counted against the live daily cap) is enforced structurally: `mode`
// rides every zk record on both sides, fixture and live never share
// trees, nullifier stores, counters, or artifacts, and lookups default to
// the safe side (fixture). Sweeps run fixture; only `live-z*` scripts flip
// to live, and never inside a sweep.

export type ZkMode = "fixture" | "live";

export const ZK_MODE: ZkMode = process.env.ZK_MODE === "live" ? "live" : "fixture";

// Dev/test RUNTIME override of the universe (live-z2 drives the live
// universe through the same adapter/gate paths the sweeps drive in
// fixture). Production reads the env once; resetSeed clears the override.
const gm = globalThis as unknown as { __layersZkModeOverride?: ZkMode | null };
export function setZkModeOverride(m: ZkMode | null): void {
  gm.__layersZkModeOverride = m;
}
export function zkMode(): ZkMode {
  return gm.__layersZkModeOverride ?? ZK_MODE;
}

/** Stock Semaphore v4 artifact depth we ship. One depth, one pinned
 * artifact pair, one ceremony transcript verified (lib/zk/ceremony.ts). */
export const MERKLE_TREE_DEPTH = 20;

/** Anonymity-set floor: the minimum number of registered, ZK-adopting
 * roots in a tier tree before a gate may claim anything about privacy.
 * Read as "named, profiled candidates the operator already runs analytics
 * on", not "anonymous strangers" (F3) — which is why the default is not
 * small. */
// PERSONA LAUNCH GO-LIVE: a value that is not a number reads as the default 50, never NaN — NaN compares false, so the
// cohort stage's `size < ZK_ANON_FLOOR` would have proved into a crowd of any size (a fail-open). Every numeric value reads
// exactly as before (a blank still reads as 1). DELIBERATE DUPLICATE of anonFloorHere() in lib/zk/anon/availability.ts.
const ZK_ANON_FLOOR_RAW = Number(process.env.ZK_ANON_FLOOR ?? 50);
export const ZK_ANON_FLOOR = Number.isFinite(ZK_ANON_FLOOR_RAW) ? Math.max(1, ZK_ANON_FLOOR_RAW) : 50;

/** Per-persona proof-history budget (C3/F2b): distinct predicates a
 * persona may prove per epoch. A hard refusal, not a warning. */
export const ZK_PROOF_BUDGET = Math.max(1, Number(process.env.ZK_PROOF_BUDGET ?? 2));

/** The tier threshold the For You gate proves against (Gate 2). */
export const ZK_GATE_TIER = Math.max(1, Math.min(10, Number(process.env.ZK_GATE_TIER ?? 2)));

export type RelayKind = "direct" | "ohttp" | "tor";
export const ZK_RELAY: RelayKind =
  process.env.ZK_RELAY === "ohttp" ? "ohttp" : process.env.ZK_RELAY === "tor" ? "tor" : "direct";
export const ZK_RELAY_URL = process.env.ZK_RELAY_URL ?? "";
/** Operator ATTESTATION that the configured relay is run by a
 * non-colluding third party. Not machine-checkable; stated as such. */
export const ZK_RELAY_THIRD_PARTY = process.env.ZK_RELAY_THIRD_PARTY === "true";

export const VALIDATOR_URL = validatorUrl();

/** Gate 1 — the anonymous channel. */
export const ZK_POW_BITS = Math.max(0, Math.min(40, Number(process.env.ZK_POW_BITS ?? 16)));
/** Jittered submission window: a queued proof is sent at a uniformly random
 * time in [min, max] after it is queued — never at a fixed offset from the
 * action that motivated it (C6/F5b). Tests set a short window. */
export const ZK_JITTER_MIN_MS = Math.max(0, Number(process.env.ZK_JITTER_MIN_MS ?? 30_000));
export const ZK_JITTER_MAX_MS = Math.max(ZK_JITTER_MIN_MS + 1, Number(process.env.ZK_JITTER_MAX_MS ?? 900_000));

/** Where the live prover caches hash-verified artifacts. Gitignored. */
export const ZK_ARTIFACT_DIR = process.env.ZK_ARTIFACT_DIR || ".zk-artifacts";

/** COHORT CONTINUITY (attack-3 F-1): the share of the cohort this client
 * last proved into that may be MISSING from the current epoch's cohort
 * before the client refuses to prove into it. An operator that rotates a
 * floor-clearing cohort between epochs to intersect a persona's proofs
 * down to one root is slowed to ≤ this churn per epoch — slowed, not
 * stopped; the posture doc says what remains (A-COHORT-ROTATION). */
export const ZK_COHORT_MAX_CHURN = Math.min(1, Math.max(0, Number(process.env.ZK_COHORT_MAX_CHURN ?? 0.2)));

/** The shortest epoch the client accepts from a validator (attack-3 F-12:
 * the epoch is the layer's privacy grain and was an operator knob). Also
 * the floor under the jitter window's sanity check (F-4). */
export const ZK_EPOCH_MIN_MS = Math.max(60_000, Number(process.env.ZK_EPOCH_MIN_MS ?? 3_600_000));

/** FIXED-SCHEDULE PREFETCH (Pass 2 Gate 0, retiring A-PREPARE-BURST): every
 * client fetches the epoch, the gate tree's leaves, the signed history and
 * the anonymous second-viewpoint head on THIS cadence (±25% CSPRNG jitter)
 * whether or not it intends to prove, and proves only from that snapshot.
 * The render path makes no validator request. Tests use a short cadence. */
export const ZK_PREFETCH_MS = Math.max(1000, Number(process.env.ZK_PREFETCH_MS ?? 600_000));

/** Constant request size on the anonymous channel (attack-1 finding 6):
 * every submission is padded to exactly this many bytes, so the relay's
 * view carries no per-submission length. */
export const ZK_SUBMIT_BYTES = 4096;

// ---------------------------------------------------------------- MULTI-FID PASS Gate 4: anon-post mode
/** the tree an anon post proves membership in — the discovery gate tree by default, or an
 * attest:<issuer>/<bucket> tree; the VALIDATOR enforces its own copy (ZK_ANON_POST_TREE) */
export const ZK_ANON_POST_TREE = String(process.env.ZK_ANON_POST_TREE ?? "").trim() || `tier-${ZK_GATE_TIER}`;
/** PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): a well-formed plain anon tree name — "valid" (every registered root: the
 *  public preview's choice, so a stranger can try a preview-only post), "tier-1".."tier-10", or "attest:<issuer>/<bucket>".
 *  lib/device/deviceEnv.server.ts forwards ZK_ANON_POST_TREE to the browser device only when this holds (else "invalid",
 *  which the tab reads as off). DELIBERATE DUPLICATE of isPlainTreeName() in lib/zk/anon/availability.ts. */
export function isPlainTreeName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (name === "valid" || /^tier-(10|[1-9])$/.test(name)) return true;
  const m = /^attest:([a-z0-9]+(?:[.-][a-z0-9]+)*)\/([a-z0-9]+(?:[.-][a-z0-9]+)*)$/.exec(name);
  return !!m && m[1].length <= 48 && m[2].length <= 32;
}
/** one anon post per root per WINDOW of this many epochs (the scope's qualifier) */
export const ZK_ANON_POST_WINDOW_EPOCHS = Math.max(1, Math.floor(Number(process.env.ZK_ANON_POST_WINDOW_EPOCHS ?? 1)));
/** the longest text an anon post may carry (Farcaster's short-cast limit) */
export const ZK_ANON_POST_MAX_CHARS = Math.max(1, Math.min(1024, Number(process.env.ZK_ANON_POST_MAX_CHARS ?? 320)));
export const anonPostWindowOf = (epoch: number): string => "w" + Math.floor(epoch / ZK_ANON_POST_WINDOW_EPOCHS);

// ---------------------------------------------------------------- PERSONA LAUNCH P3 (D4): K anon posts per window
/** A knob whose BLANK value means unset: a variable blanked by name must fall back to the default, never to
 *  Number("") = 0 (a blank ZK_ANON_POST_SLOTS would silently become K = 1). DELIBERATE DUPLICATE of envInt() in
 *  validator/zk.js — the two sides must read the same K from the same environment. */
export function envInt(raw: string | undefined, def: number, lo: number, hi: number): number {
  if (raw === undefined || String(raw).trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : def;
}
/** K: anonymous posts per PERSON per window, shared across that person's personas (default 4, integer 1..16). Each post
 * proves under its own (window, slot) scope — one nullifier per slot — so the posts of one window stay unlinkable to
 * the operator and a (K+1)th is impossible. DELIBERATE DUPLICATE of anonPostSlots() in validator/zk.js. THIS is the K
 * the client chooses slots with — never the validator's (lib/zk/gate.ts: a validator serving one client a different K
 * could tag that client's posts; a mismatch makes anon posting unavailable instead). */
export const ZK_ANON_POST_SLOTS = envInt(process.env.ZK_ANON_POST_SLOTS, 4, 1, 16);

// ---------------------------------------------------------------- PERSONA LAUNCH P8 (D-X-SLOTS): the @totem X outbox
/** K_X: anonymous X copies per PERSON per window (default 1, integer 1..4), in their OWN slots under their own scope
 * (x-anon-post/w<n>/s<i>) — an X copy never spends an anon-post slot and never shares a nullifier with one. Shared across
 * the person's personas like K. DELIBERATE DUPLICATE of xAnonPostSlots() in validator/zk.js; THIS is the K_X the client
 * picks X slots with — a served K_X is only ever compared with it (lib/zk/gate.ts), never adopted. */
export const ZK_X_ANON_POST_SLOTS = envInt(process.env.ZK_X_ANON_POST_SLOTS, 1, 1, 4);

// ---------------------------------------------------------------- PERSONA LAUNCH P5 (D1, R6): reach tiers
/** The crowd floor of a REACH tree (attest:fc.reach/gte-10k, …): a reach tier is offered, proved into, accepted and
 * labelled only while at least this many accounts are in it. It is NEVER below ZK_ANON_FLOOR, and its own default is
 * D1's 50 whatever ZK_ANON_FLOOR says — the owner service runs ZK_ANON_FLOOR=1 for its plain anonymous account (a crowd
 * of one it discloses, A-ANON-SET-OF-ONE), and a reach tier of one would name the owner's main account outright.
 * DELIBERATE DUPLICATE of reachFloor() in validator/zk.js (the two sides read the same floor from the same env). */
export const ZK_REACH_FLOOR = Math.max(ZK_ANON_FLOOR, envInt(process.env.ZK_REACH_FLOOR, 50, 1, 1_000_000));
