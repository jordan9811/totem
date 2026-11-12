// MEGA PASS 2 Gate 2 — THE CANONICAL SIGNALS, normalized to [0, 1], and the
// lens arithmetic over them. PURE: the feed's ranking, the evaluate API
// and the preview all call these same two functions, so a lens's score is
// inspectable term by term and the breakdown sums to the score exactly.
import type { CastStakeSummary } from "@/lib/influence/types";
import { LENS_SIGNALS, type LensSignal, type LensSpec, type LensTerm } from "./types";

export interface SignalContext {
  post: { text: string; likes: number; recasts: number; minutesAgo: number; truncate?: boolean };
  /** the author's tier as this viewer knows it (proven under zk, the seed tier otherwise) */
  tier: number;
  /** "<issuer>/<bucket>" the author PROVED this epoch */
  attestations: string[];
  stakes?: CastStakeSummary | null;
  /** a desk the viewer subscribes to annotated this cast */
  curatorFlagged: boolean;
  /** the cast's story is caught-up for the viewer */
  saturated: boolean;
}

// TUNE: normalizations — the same log curve engagement already uses; stakes saturate at 20 points a
// direction; dwell saturates at ~400 words (two minutes at reading speed); the early curve is the
// reader's earliness: a young post that already carries stakes from a few people.
const eng = (n: number) => Math.min(1, Math.log10(1 + Math.max(0, n)) / 4);
const stake = (n: number | undefined) => Math.min(1, (n ?? 0) / 20);

export function signalsFor(ctx: SignalContext): Record<LensSignal, number> {
  const words = ctx.post.text ? ctx.post.text.trim().split(/\s+/).length : 0;
  const ageHours = Math.max(0, ctx.post.minutesAgo) / 60;
  const by = ctx.stakes?.byDirection;
  return {
    recasts: eng(ctx.post.recasts),
    likes: eng(ctx.post.likes),
    stakesGood: stake(by?.good),
    stakesWorthReading: stake(by?.["worth-reading"]),
    stakesWrong: stake(by?.wrong),
    stakesMisleading: stake(by?.misleading),
    stakesNoteWorthy: stake(by?.["note-worthy"]),
    // reading-time DEMAND of the content — never measured attention (A-MEGA2-DWELL-IS-CONTENT-NOT-BEHAVIOUR)
    dwell: Math.min(1, (words + (ctx.post.truncate ? 200 : 0)) / 400),
    tier: Math.min(1, Math.max(0, ctx.tier) / 10),
    attestations: Math.min(1, ctx.attestations.length / 2),
    curatorSubscriptions: ctx.curatorFlagged ? 1 : 0,
    earlyCurve: (1 / (1 + ageHours / 12)) * Math.min(1, (ctx.stakes?.stakers ?? 0) / 3),
    saturation: ctx.saturated ? 1 : 0,
  };
}

export function lensTerms(spec: LensSpec, signals: Record<LensSignal, number>): LensTerm[] {
  return LENS_SIGNALS.map((signal) => {
    const raw = signals[signal];
    const weight = spec.signals[signal] ?? 0;
    return { signal, raw, weight, contribution: raw * weight };
  });
}

/** Σ contributions — the ONE arithmetic; the breakdown is the same numbers */
export function lensScore(spec: LensSpec, signals: Record<LensSignal, number>): number {
  let total = 0;
  for (const t of lensTerms(spec, signals)) total += t.contribution;
  return total;
}
