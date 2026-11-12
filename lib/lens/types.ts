// MEGA PASS 2 Gate 2 — LENSES: the algo through different curves.
//
// A lens is a NAMED WEIGHTING over the same canonical signals — not just
// what is ranked but how influence is counted. It is serializable, signed
// and shareable through the EXISTING portable-algorithm pipeline: a lens
// IS an AlgoArtifact (`kind: "lens"`) carrying a `lens` section — the
// signal weights and an `influenceDistribution` (the accrual curve set,
// lib/influence/accrual.ts). Same signature, same mandatory preview, same
// guardrails, same provenance chain.
//
// THE CANONICAL LENS is the identity: every signal weight 0 and the
// canonical curves — the default feed under it is byte-for-byte the feed
// without one. Switching the active lens on a mode is literally "view the
// global algo through a different lens".
//
// DWELL, stated once: the `dwell` signal is the READING-TIME DEMAND of
// the content (its length), never measured viewer attention — the
// relationship event log bars dwell/impression events by construction and
// this build honours that (A-MEGA2-DWELL-IS-CONTENT-NOT-BEHAVIOUR).
import type { InfluenceCurves } from "@/lib/influence/curves";

export const LENS_SIGNALS = [
  "recasts",
  "likes",
  "stakesGood",
  "stakesWorthReading",
  "stakesWrong",
  "stakesMisleading",
  "stakesNoteWorthy",
  "dwell",
  "tier",
  "attestations",
  "curatorSubscriptions",
  "earlyCurve",
  "saturation",
] as const;
export type LensSignal = (typeof LENS_SIGNALS)[number];

/** weights are -5..5; a negative weight ranks the signal DOWN */
export const LENS_WEIGHT_MIN = -5;
export const LENS_WEIGHT_MAX = 5;

export interface LensSpec {
  signals: Record<LensSignal, number>;
  influenceDistribution: InfluenceCurves;
}

/** THE FIVE GUARDRAILS a lens may never reach — refused BY NAME, and the
 * whole import dies (an artifact that tried once is not one to run):
 * the composer destination indicator, correction cards for engaged posts,
 * disclosure behaviour, the k-floor, and the allowance overdraw rule. */
export const LENS_PROTECTED_KEYS: ReadonlyArray<[RegExp, string]> = [
  [/destination|audienceLine|composer/i, "the composer destination indicator"],
  [/correction|suppressNotes|hideNotes/i, "correction cards for engaged posts"],
  [/disclosure|grant|linkage/i, "disclosure behaviour"],
  [/kFloor|floor|anonymity/i, "the k-floor"],
  [/overdraw|allowance|balance/i, "the allowance overdraw rule"],
];

export interface StoredLens {
  id: string;
  name: string;
  summary: string;
  authorHandle: string;
  authorPersonaId: string;
  spec: LensSpec;
  /** the signed artifact it arrived as (or was exported as) — provenance rides here */
  artifactSignature: string;
  forkedFrom?: { authorHandle: string; algoVersion: number; name: string };
  seeded?: boolean;
  importedAt: number;
}

export function zeroSignals(): Record<LensSignal, number> {
  const out = {} as Record<LensSignal, number>;
  for (const s of LENS_SIGNALS) out[s] = 0;
  return out;
}

export interface LensTerm {
  signal: LensSignal;
  raw: number;
  weight: number;
  contribution: number;
}
