import "server-only";
// MEGA PASS 2 Gate 2 — LENSES: store, seed, export, apply, evaluate.
//
// A lens rides the EXISTING portable-algorithm pipeline: it is an
// AlgoArtifact with `kind: "lens"` and a `lens` section (lib/algo/artifact.ts
// sanitizes it — unknown keys stripped and reported, the five protected
// surfaces refused BY NAME and fatal). This module owns what happens after
// the pipeline: storage (like filter packs), the canonical + seeded lenses,
// "which lens does this mode see through" (the mode's own pin, else a pack's
// pin, else canonical), the inspectable evaluate breakdown, and the
// influence delta a preview shows ("under this lens, your accrual last epoch
// would have been X vs Y").
import { createHash } from "@/lib/platform/crypto";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaById, postByHash, state, persistNs } from "@/lib/adapters/mock/store";
import type { ModeDefinition } from "@/lib/adapters/types";
import type { AlgoArtifact } from "@/lib/algo/artifact";
import { signArtifact } from "@/lib/algo/artifact";
import { CANONICAL_CURVES, evaluateEpochFor, type InfluenceCurves } from "@/lib/influence/accrual";
import { packsForMode } from "@/lib/packs/service";
import { lensTerms, signalsFor, type SignalContext } from "./signals";
import { zeroSignals, type LensSignal, type LensSpec, type LensTerm, type StoredLens } from "./types";

export const CANONICAL_LENS_ID = "lens_canonical";
export const SLOW_READS_LENS_ID = "lens_slow_reads";

/** the identity lens: zero weights, the canonical curves — the feed under it is the feed without one */
export const CANONICAL_SPEC: LensSpec = Object.freeze({
  signals: Object.freeze(zeroSignals()) as Record<LensSignal, number>,
  influenceDistribution: CANONICAL_CURVES,
});

// TUNE: owner has unresolved design intent here — the seeded "dwell-heavy, early-curve-off" lens is a
// demonstration of the modularity (it visibly re-ranks the seeded feed toward long reads and recomputes a
// coordinated cluster's accrual downward), not a product recommendation.
export const SLOW_READS_SPEC: LensSpec = Object.freeze({
  signals: Object.freeze({
    ...zeroSignals(),
    dwell: 3,
    stakesWorthReading: 1,
    stakesNoteWorthy: 0.5,
    recasts: -0.5,
    likes: -0.5,
    earlyCurve: 0,
    saturation: -1,
  }) as Record<LensSignal, number>,
  influenceDistribution: Object.freeze({
    early: Object.freeze({ enabled: false, weight: 0, halfLifeRank: 3 }),
    confirmation: Object.freeze({ confirmedWeight: 1, unconfirmedWeight: 0 }),
    pointsPerStewardship: 5,
    maxStewardshipPerEpoch: 10,
    coordination: Object.freeze({ enabled: true, penalty: 0.5 }),
  }),
});

// the lens section's whitelist + guardrails live in lib/lens/sanitize.ts (pure; the artifact sanitizer calls it)
export { sanitizeLensSpec } from "./sanitize";
export type { LensSanitizeResult } from "./sanitize";

// ----------------------------------------------------------------- store

function lensIdOf(signature: string): string {
  return "lens_" + createHash("sha256").update(signature).digest("hex").slice(0, 12);
}

export function listLenses(): StoredLens[] {
  return [...state().lenses.values()].sort((a, b) => (a.seeded === b.seeded ? a.importedAt - b.importedAt : a.seeded ? -1 : 1));
}

export function getLens(id: string): StoredLens | null {
  return state().lenses.get(id) ?? null;
}

/** store an already-sanitized, already-verified lens artifact */
export async function storeLens(artifact: AlgoArtifact): Promise<StoredLens> {
  if (!artifact.lens) throw new Error("the artifact carries no lens section");
  const s = state();
  const id = lensIdOf(artifact.signature);
  const existing = s.lenses.get(id);
  if (existing) return existing;
  const lens: StoredLens = {
    id,
    name: artifact.name,
    summary: artifact.summary,
    authorHandle: artifact.authorHandle,
    authorPersonaId: artifact.authorPersonaId,
    spec: artifact.lens,
    artifactSignature: artifact.signature,
    ...(artifact.forkedFrom ? { forkedFrom: artifact.forkedFrom } : {}),
    importedAt: Date.now(),
  };
  s.lenses.set(id, lens);
  await persistNs("lenses");
  return lens;
}

const DEFAULT_RANKING = { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 };

/** the signed artifact for a stored lens (or for the canonical / slow-reads specs) — what "share this lens" produces */
export function exportLens(lensId: string, actorPersonaId: string): AlgoArtifact {
  const lens = getLens(lensId);
  if (!lens) throw new Error(`lens ${lensId} not found`);
  const author = personaById.get(actorPersonaId);
  const body: Omit<AlgoArtifact, "signature"> = {
    kind: "lens",
    schemaVersion: 1,
    name: lens.name,
    summary: lens.summary,
    authorPersonaId: actorPersonaId,
    authorHandle: author?.handle ?? "unknown",
    algoVersion: 1,
    ranking: DEFAULT_RANKING,
    rules: [],
    modeFlags: {},
    lens: { signals: { ...lens.spec.signals }, influenceDistribution: JSON.parse(JSON.stringify(lens.spec.influenceDistribution)) },
    createdAt: Date.now(),
    ...(lens.seeded ? {} : { forkedFrom: { authorHandle: lens.authorHandle, algoVersion: 1, name: lens.name } }),
  };
  const signature = signArtifact(body);
  if (signature === null) throw new Error(`cannot sign as ${actorPersonaId} — export refused`);
  return { ...body, signature };
}

/** the two seeded lenses, stored through the same signed shape (idempotent) */
export async function seedLenses(): Promise<number> {
  const s = state();
  let added = 0;
  const seedOne = (id: string, name: string, summary: string, spec: LensSpec) => {
    if (s.lenses.has(id)) return;
    s.lenses.set(id, {
      id,
      name,
      summary,
      authorHandle: "layers",
      authorPersonaId: "layers",
      spec: { signals: { ...spec.signals }, influenceDistribution: JSON.parse(JSON.stringify(spec.influenceDistribution)) },
      artifactSignature: "seed",
      seeded: true,
      importedAt: 0,
    });
    added++;
  };
  seedOne(CANONICAL_LENS_ID, "Canonical", "The global algo as it is: every signal at its default weight, the canonical accrual curves.", CANONICAL_SPEC);
  seedOne(SLOW_READS_LENS_ID, "Slow reads", "Dwell-heavy, early-curve off: long reads and worth-reading stakes up, quick engagement down; accrual ignores earliness and discounts coordinated staking by half.", SLOW_READS_SPEC);
  if (added) await persistNs("lenses").catch(() => {});
  return added;
}

// ---------------------------------------------------------------- apply

/** which lens a mode sees through: its own pin, else the first attached pack's pin, else canonical */
export function lensForMode(mode: Pick<ModeDefinition, "lens" | "filterPackIds"> | null | undefined): { id: string; spec: LensSpec; source: "mode" | "pack" | "canonical" } {
  if (mode?.lens) {
    const l = getLens(mode.lens);
    if (l) return { id: l.id, spec: l.spec, source: "mode" };
  }
  try {
    for (const pack of packsForMode(mode?.filterPackIds)) {
      if (pack.artifact.lens) return { id: pack.id + ":lens", spec: pack.artifact.lens, source: "pack" };
    }
  } catch {
    /* no packs: canonical */
  }
  return { id: CANONICAL_LENS_ID, spec: CANONICAL_SPEC, source: "canonical" };
}

export async function applyLens(modeId: string, lensId: string | null): Promise<ModeDefinition> {
  if (lensId !== null && !getLens(lensId)) throw new Error(`lens ${lensId} not found`);
  return retryAdapter(() => adapters.mode.update(modeId, { lens: lensId }));
}

// ------------------------------------------------------------- evaluate

export interface LensEvaluation {
  lensId: string;
  castHash: string;
  /** the mode's own ranking terms (recency / engagement / affinity / cluster) */
  base: { term: string; raw: number; weight: number; contribution: number }[];
  lens: LensTerm[];
  baseScore: number;
  lensScore: number;
  score: number;
}

/** the inspectable breakdown — the SAME signal extraction and arithmetic the feed ranks with */
export async function evaluateCast(lensId: string, castHash: string, viewerPersonaId: string): Promise<LensEvaluation | null> {
  const lens = lensId === CANONICAL_LENS_ID ? { id: CANONICAL_LENS_ID, spec: CANONICAL_SPEC } : getLens(lensId);
  if (!lens) return null;
  const post = postByHash.get(castHash);
  if (!post) return null;
  const mode = await retryAdapter(() => adapters.mode.getActive(viewerPersonaId));
  const { baseRankTerms, tierResolver } = await import("@/lib/feed");
  const { followingFor } = await import("@/lib/eventlog/log");
  const { provenAttestationsFor } = await import("@/lib/attest/proven");
  const { subscribedAnnotations } = await import("@/lib/curators/annotations");
  const tierOf = await tierResolver();
  const tier = tierOf(post.authorPersonaId, personaById.get(post.authorPersonaId)?.tier ?? 1);
  const base = baseRankTerms(post, mode, followingFor(viewerPersonaId), tier);
  let stakes = null;
  try {
    // PERSONA LAUNCH (final verify): retried like every adapter read here — one transient failure dropped the stake terms
    stakes = (await retryAdapter(() => adapters.influence.stakesForCast(castHash))).summary;
  } catch {
    stakes = null;
  }
  let saturated = false;
  try {
    const sat = await retryAdapter(() => adapters.feedHealth.listSaturated(viewerPersonaId, mode.id));
    saturated = !!post.storyId && sat.some((e) => e.storyId === post.storyId);
  } catch {
    saturated = false;
  }
  let curatorFlagged = false;
  try {
    curatorFlagged = subscribedAnnotations(viewerPersonaId).some(({ annotation }) => annotation.targetCastId === castHash);
  } catch {
    curatorFlagged = false;
  }
  const ctx: SignalContext = {
    post: { text: post.text, likes: post.likes, recasts: post.recasts, minutesAgo: post.minutesAgo, truncate: post.truncate },
    tier,
    attestations: provenAttestationsFor(post.authorPersonaId),
    stakes,
    curatorFlagged,
    saturated,
  };
  const terms = lensTerms(lens.spec, signalsFor(ctx));
  const baseScore = base.reduce((a, t) => a + t.contribution, 0);
  const lensScore = terms.reduce((a, t) => a + t.contribution, 0);
  return { lensId: lens.id, castHash, base, lens: terms, baseScore, lensScore, score: baseScore + lensScore };
}

// -------------------------------------------------------- influence delta

export interface InfluenceDelta {
  epoch: number;
  canonical: { score: number; count: number; confirmed: number; evaluated: number };
  underLens: { score: number; count: number; confirmed: number; evaluated: number };
}

/** "under this lens, your accrual last epoch would have been X vs Y" — over the seeded / real history */
export async function influenceDelta(spec: LensSpec, personaIds: string[], viewerPersonaId: string, epoch?: number): Promise<InfluenceDelta> {
  const { currentEpoch } = await import("@/lib/influence/allowance");
  const e = epoch ?? (await currentEpoch()) - 1;
  const [c, u] = await Promise.all([
    evaluateEpochFor(personaIds, e, CANONICAL_CURVES, viewerPersonaId),
    evaluateEpochFor(personaIds, e, spec.influenceDistribution, viewerPersonaId),
  ]);
  const pick = (x: typeof c) => ({ score: x.score, count: x.count, confirmed: x.confirmed, evaluated: x.evaluated });
  return { epoch: e, canonical: pick(c), underLens: pick(u) };
}

export type { InfluenceCurves };
