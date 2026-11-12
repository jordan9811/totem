// MEGA PASS 2 — THE INFLUENCE CURVE SET. Pure (no node, no server-only):
// the artifact sanitizer and the settings panes read it too. The arithmetic
// that USES it lives in lib/influence/accrual.ts.
//
// A lens's `influenceDistribution` IS one of these — how influence is
// counted under that lens. The canonical values are the default lens's.

export interface InfluenceCurves {
  /** "early to good content": ONE weighted term, not the mechanic. rank 0 = the
   * first staker on the cast; the term halves every `halfLifeRank` ranks. */
  early: { enabled: boolean; weight: number; halfLifeRank: number };
  /** what a confirmed / unconfirmed stake is worth, per point staked */
  confirmation: { confirmedWeight: number; unconfirmedWeight: number };
  /** points of weighted stake per one `stewardship` rep event */
  pointsPerStewardship: number;
  /** ceiling per evaluated epoch, so one epoch cannot mint unbounded rep */
  maxStewardshipPerEpoch: number;
  /** Gate 2: a lens MAY weight against coordinated staking (a stake inside a
   * detected cluster is discounted by `penalty`, 0..1). Legibility made
   * actionable by the lens's author — never enforced by the platform. */
  coordination?: { enabled: boolean; penalty: number };
}

// TUNE: owner has unresolved design intent here — the early-to-content
// curve's shape and weight, and the creator-economy tie-in it is meant to
// feed, are not settled. Conservative defaults: early is a modest bonus
// (at most +50% on the first staker, halving every three ranks), an
// unconfirmed stake earns nothing, five confirmed points make one event,
// coordination is not weighted against by default.
export const CANONICAL_CURVES: InfluenceCurves = Object.freeze({
  early: Object.freeze({ enabled: true, weight: 0.5, halfLifeRank: 3 }),
  confirmation: Object.freeze({ confirmedWeight: 1, unconfirmedWeight: 0 }),
  pointsPerStewardship: 5,
  maxStewardshipPerEpoch: 10,
  coordination: Object.freeze({ enabled: false, penalty: 0 }),
});

/** whitelist + range check; null = malformed (callers refuse) */
export function sanitizeCurves(raw: unknown): InfluenceCurves | null {
  const c = raw as Partial<InfluenceCurves> | null;
  if (!c || typeof c !== "object") return null;
  const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const early = c.early && typeof c.early === "object" ? c.early : null;
  const conf = c.confirmation && typeof c.confirmation === "object" ? c.confirmation : null;
  const w = early ? num(early.weight, 0, 5) : null;
  const h = early ? num(early.halfLifeRank, 1, 100) : null;
  const cw = conf ? num(conf.confirmedWeight, 0, 10) : null;
  const uw = conf ? num(conf.unconfirmedWeight, 0, 10) : null;
  const pps = num(c.pointsPerStewardship, 1, 1000);
  const cap = num(c.maxStewardshipPerEpoch, 0, 1000);
  if (w === null || h === null || cw === null || uw === null || pps === null || cap === null || !early || typeof early.enabled !== "boolean") return null;
  let coordination: InfluenceCurves["coordination"] = { enabled: false, penalty: 0 };
  if (c.coordination !== undefined) {
    const co = c.coordination as { enabled?: unknown; penalty?: unknown } | null;
    const pen = co && typeof co === "object" ? num(co.penalty, 0, 1) : null;
    if (!co || typeof co !== "object" || typeof co.enabled !== "boolean" || pen === null) return null;
    coordination = { enabled: co.enabled, penalty: pen };
  }
  return { early: { enabled: early.enabled, weight: w, halfLifeRank: h }, confirmation: { confirmedWeight: cw, unconfirmedWeight: uw }, pointsPerStewardship: pps, maxStewardshipPerEpoch: cap, coordination };
}
