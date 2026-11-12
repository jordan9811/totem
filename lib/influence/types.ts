// MEGA PASS 2 — REPUTATION UBI: the shared types. Pure (no node imports):
// the settings pane is a client component and reads these too.
//
// THE MECHANIC, stated once: every root receives a recurring, NON-
// TRANSFERABLE allowance of influence per epoch. Acting (recast, like,
// note, refute, curate) may SPEND some of it as a STAKE on that content —
// a signed, public, per-persona event carrying a DIRECTION on a spectrum.
// Being a good steward (stakes a delayed evaluation later confirms) accrues
// reputation on the ROOT through the existing rep machinery, which raises
// the next epoch's allowance. Influence is never money and never moves
// between accounts: there is no transfer operation anywhere in the
// interface, and the type-level assertion at the bottom of this file makes
// adding one a compile error, not a code review.
import type { InfluenceAdapter } from "@/lib/adapters/types";

export const STAKE_ACTIONS = ["recast", "like", "note", "refute", "curate"] as const;
export type StakeAction = (typeof STAKE_ACTIONS)[number];

/** THE AWARD SPECTRUM. Mostly hidden in the default UI; exposed in the
 * settings "influence" layer and the read API. The community-notes and
 * refutation surfaces consume `wrong` / `misleading` / `note-worthy`. */
export const STAKE_DIRECTIONS = ["good", "worth-reading", "wrong", "misleading", "note-worthy"] as const;
export type StakeDirection = (typeof STAKE_DIRECTIONS)[number];

export const DEFAULT_DIRECTION: Record<StakeAction, StakeDirection> = {
  recast: "good",
  like: "good",
  note: "note-worthy",
  refute: "wrong",
  curate: "worth-reading",
};

// TUNE: owner has unresolved design intent here — the default stake per
// action type is a small conservative figure; user-settable per action in
// settings. Zero is a valid setting (the action still works; no stake).
export const DEFAULT_STAKE: Record<StakeAction, number> = { recast: 2, like: 1, note: 2, refute: 3, curate: 2 };

/** a hard ceiling on any single stake, whatever the settings say */
export const MAX_STAKE_PER_EVENT = 50;
/** a stake may name an epoch this far behind the current one (seeding, clock skew), never ahead */
export const MAX_STAKE_BACKDATE_EPOCHS = 3;

/** the per-epoch allowance a ROOT at this rep tier receives.
 * TUNE: owner has unresolved design intent here — linear in tier, floor
 * 14 at tier 1, 50 at tier 10; tier 0 (unproven under zk) receives nothing
 * until a proof lands, because an unproven persona has no tier at all. */
export function allowanceForTier(tier: number): number {
  if (!Number.isFinite(tier) || tier <= 0) return 0;
  return 10 + 4 * Math.min(10, Math.floor(tier));
}

/** a stake as the validator stores and serves it: PER-PERSONA, signed by
 * the persona's own key, hour-grained, and carrying no root, no balance,
 * no device — the validator never learns what the allowance was */
export interface StakeEvent {
  id: string;
  mode: "fixture" | "live";
  personaId: string;
  castHash: string;
  action: StakeAction;
  direction: StakeDirection;
  amount: number;
  epoch: number;
  nonce: string;
  /** hour-grained, set by the validator */
  at: number;
  pubkey: string;
  signature: string;
}

export type StakeBody = Omit<StakeEvent, "id" | "at" | "pubkey" | "signature">;

/** DELIBERATE DUPLICATE of stakeCanonical() in validator/stakes.js — byte-identical or every stake is refused */
export function stakeCanonical(e: StakeBody): string {
  return ["layers-stake/1", e.mode, e.personaId, e.castHash, e.action, e.direction, String(e.amount), String(e.epoch), e.nonce].join("|");
}

export function isStakeAction(x: unknown): x is StakeAction {
  return typeof x === "string" && (STAKE_ACTIONS as readonly string[]).includes(x);
}
export function isStakeDirection(x: unknown): x is StakeDirection {
  return typeof x === "string" && (STAKE_DIRECTIONS as readonly string[]).includes(x);
}

export interface CastStakeSummary {
  total: number;
  stakers: number;
  byDirection: Record<StakeDirection, number>;
  /** the viewer's own stake total on this cast, if any */
  viewerStaked?: number;
}

export function emptySummary(): CastStakeSummary {
  return { total: 0, stakers: 0, byDirection: { good: 0, "worth-reading": 0, wrong: 0, misleading: 0, "note-worthy": 0 } };
}

// ---------------------------------------------------------------- NO TRANSFER, at the type level
// The adapter contract may never grow a method that moves influence from
// one account to another. Naming one here turns this line into a compile
// error (`never` is not assignable), so the safety-set grep in the Gate 1
// suite has a type-checked twin. Adding "transfer" to InfluenceAdapter
// fails `tsc` before it fails a test.
type ForbiddenInfluenceOps = Extract<keyof InfluenceAdapter, "transfer" | "send" | "move" | "gift" | "delegate" | "lend" | "sell">;
export const INFLUENCE_HAS_NO_TRANSFER: [ForbiddenInfluenceOps] extends [never] ? true : never = true;
