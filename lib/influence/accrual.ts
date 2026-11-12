import "server-only";
// MEGA PASS 2 Gate 1 — ACCRUAL: stewardship measured by a LENS, not by
// consensus, over a DELAYED evaluation window.
//
// A stake placed in epoch E is evaluated in epoch E+1 against what the
// canonical signals say by then: does the cast still exist (non-
// retraction), does a qualifying community note stand against it, does it
// hold standing under the refutation rules. A `good` stake on a cast a
// note later corrected is not stewardship; a `wrong` stake on it is. The
// "early to good content" idea is ONE weighted term — a configurable
// curve with a conservative default — never the mechanic itself.
//
// NOT a signal here, deliberately: dwell. The relationship event log bars
// dwell/impression events by construction (lib/eventlog/types.ts), and an
// accrual formula that rewarded "how long people looked" would need the
// surveillance that log exists to refuse. The prompt lists dwell among
// the confirmation signals; this build declines it and says so
// (A-MEGA2-NO-DWELL in the posture doc).
//
// Where the accrual LANDS: on the ROOT, through the existing rep machinery
// — a `stewardship` rep event posted with the account's own root handle,
// exactly the way the legacy tier is asked (lib/validator.ts tierFor).
// The validator's tier trees rebuild from rep at the epoch boundary, so
// under zk the persona then PROVES the new tier the same way it proves
// any tier. Nothing here is proof material; nothing here is a new
// primitive. The evaluation itself is a PURE function over public stake
// rows, so anyone can compute any persona's accrual under any lens — that
// is the legibility the mechanic promises (lib/influence/clusters.ts).
import { validatorUrl } from "@/lib/ports";
import { CANONICAL_CURVES, type InfluenceCurves } from "./curves";
import type { StakeEvent } from "./types";
import { accruals, currentEpoch, ownPersonaIdsAll, recordAccrual, type AccrualRecord } from "./allowance";
import { noteWorthyStakersByCast, stakesInEpoch } from "./stakes";

// THE CURVE SET lives in lib/influence/curves.ts (pure — the artifact sanitizer and the settings panes read it);
// re-exported here so every existing caller keeps its import.
export { CANONICAL_CURVES, sanitizeCurves } from "./curves";
export type { InfluenceCurves } from "./curves";

export interface EvaluationContext {
  castExists(castHash: string): boolean;
  qualifyingNoteOn(castHash: string): boolean;
  standingHolds(castHash: string): boolean;
  /** 0 = first staker on the cast, by (hour, id) */
  rankAmongStakers(castHash: string, stakeId: string): number;
  /** Gate 2: the stake sits inside a detected coordinated cluster (lib/influence/clusters.ts) */
  inCluster(stakeId: string): boolean;
}

export interface EvaluatedStake {
  id: string;
  castHash: string;
  direction: StakeEvent["direction"];
  amount: number;
  confirmed: boolean;
  reason: string;
  earlyRank: number;
  earlyTerm: number;
  coordinated: boolean;
  weight: number;
}

export interface Evaluation {
  evaluated: number;
  confirmed: number;
  score: number;
  count: number;
  items: EvaluatedStake[];
}

/** PURE. The same function the owner's settlement, the influence layer and
 * a lens preview all call — one arithmetic, no black box. */
export function evaluateStakes(rows: StakeEvent[], ctx: EvaluationContext, curves: InfluenceCurves = CANONICAL_CURVES): Evaluation {
  const items: EvaluatedStake[] = [];
  let score = 0;
  for (const r of rows) {
    let confirmed = false;
    let reason: string;
    if (!ctx.castExists(r.castHash)) {
      confirmed = r.direction === "wrong" || r.direction === "misleading";
      reason = confirmed ? "the cast is gone (retracted) — a wrong/misleading stake is confirmed" : "the cast is gone (retracted)";
    } else {
      const noted = ctx.qualifyingNoteOn(r.castHash);
      const standing = ctx.standingHolds(r.castHash);
      switch (r.direction) {
        case "good":
        case "worth-reading":
          confirmed = !noted && standing;
          reason = confirmed ? "no qualifying note, standing held" : noted ? "a qualifying note stands against the cast" : "the cast lost standing";
          break;
        case "wrong":
        case "misleading":
          confirmed = noted || !standing;
          reason = confirmed ? (noted ? "a qualifying note confirms it" : "the cast lost standing") : "no note and standing held — unconfirmed";
          break;
        case "note-worthy":
          confirmed = noted;
          reason = confirmed ? "a qualifying note landed" : "no qualifying note yet";
          break;
      }
    }
    const earlyRank = ctx.rankAmongStakers(r.castHash, r.id);
    const earlyTerm = curves.early.enabled ? curves.early.weight * Math.pow(0.5, earlyRank / curves.early.halfLifeRank) : 0;
    const base = confirmed ? curves.confirmation.confirmedWeight : curves.confirmation.unconfirmedWeight;
    // Gate 2: a lens may discount stakes inside a detected coordinated cluster — legibility made actionable by the lens author
    const coordinated = ctx.inCluster(r.id);
    const coord = curves.coordination?.enabled && coordinated ? 1 - curves.coordination.penalty : 1;
    const weight = r.amount * base * (1 + earlyTerm) * coord;
    score += weight;
    items.push({ id: r.id, castHash: r.castHash, direction: r.direction, amount: r.amount, confirmed, reason, earlyRank, earlyTerm, coordinated, weight });
  }
  const count = Math.min(curves.maxStewardshipPerEpoch, Math.floor(score / curves.pointsPerStewardship));
  return { evaluated: rows.length, confirmed: items.filter((i) => i.confirmed).length, score, count, items };
}

/** the context for one epoch's stakes, from canonical signals only */
export async function buildContext(epochRows: StakeEvent[], viewerPersonaId: string): Promise<EvaluationContext> {
  const { postByHash, SEED_NOTES } = await import("@/lib/adapters/mock/store");
  const { holdsStanding } = await import("@/lib/refutation/edges");
  const { personaById } = await import("@/lib/adapters/mock/store");
  // stake-backed endorsements: the same rule the reinjection gate applies (feedHealth.reinjectionsFor)
  const backed = noteWorthyStakersByCast(epochRows);
  const noted = new Set<string>();
  for (const n of SEED_NOTES) {
    const tier = personaById.get(n.authorPersonaId)?.tier ?? 1;
    if (tier >= 3 && n.endorsements + (backed.get(n.postHash) ?? 0) >= 2) noted.add(n.postHash);
  }
  // the coordinated clusters of the epoch, so a lens can discount them (Gate 2)
  const { detectClusters } = await import("./clusters");
  const clustered = new Set<string>();
  for (const c of detectClusters(epochRows)) {
    const members = new Set(c.members);
    const casts = new Set(c.casts);
    for (const r of epochRows) if (r.epoch === c.epoch && r.direction === c.direction && members.has(r.personaId) && casts.has(r.castHash)) clustered.add(r.id);
  }
  const order = new Map<string, string[]>();
  for (const r of [...epochRows].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    const list = order.get(r.castHash) ?? [];
    list.push(r.id);
    order.set(r.castHash, list);
  }
  return {
    castExists: (h) => postByHash.has(h),
    qualifyingNoteOn: (h) => noted.has(h),
    standingHolds: (h) => {
      try {
        return holdsStanding(h, viewerPersonaId);
      } catch {
        return true;
      }
    },
    rankAmongStakers: (h, id) => Math.max(0, (order.get(h) ?? []).indexOf(id)),
    inCluster: (id) => clustered.has(id),
  };
}

/** evaluate a set of personas' stakes for one epoch under a curve set — the
 * influence layer's view and a lens preview's "under this lens, X vs Y" */
export async function evaluateEpochFor(personaIds: string[], epoch: number, curves: InfluenceCurves = CANONICAL_CURVES, viewerPersonaId?: string): Promise<Evaluation> {
  const rows = await stakesInEpoch(epoch);
  const ctx = await buildContext(rows, viewerPersonaId ?? (await ownPersonaIdsAll())[0]);
  const mine = rows.filter((r) => personaIds.includes(r.personaId));
  return evaluateStakes(mine, ctx, curves);
}

export type SettleResult =
  | { ok: true; posted: boolean; record: AccrualRecord; evaluation: Evaluation }
  | { ok: false; reason: string };

/** THE DELAYED WINDOW, settled: evaluate this root's stakes from the
 * previous epoch and post the stewardship count on the root. Idempotent
 * per evaluated epoch (the validator dedupes on sourceId, and the vault
 * remembers). Never evaluates the CURRENT epoch — the window must close. */
export async function settleStewardship(opts: { evaluatedEpoch?: number } = {}): Promise<SettleResult> {
  const now = await currentEpoch();
  const evaluatedEpoch = opts.evaluatedEpoch ?? now - 1;
  if (!Number.isInteger(evaluatedEpoch) || evaluatedEpoch < 0) return { ok: false, reason: "nothing to evaluate yet" };
  if (evaluatedEpoch >= now) return { ok: false, reason: `epoch ${evaluatedEpoch} is not closed yet — the evaluation window is one epoch behind, by design` };
  const sourceId = `stewardship:${evaluatedEpoch}`;
  const prior = (await accruals()).find((a) => a.sourceId === sourceId);
  const own = await ownPersonaIdsAll();
  const evaluation = await evaluateEpochFor(own, evaluatedEpoch, CANONICAL_CURVES, own[0]);
  if (prior) return { ok: true, posted: false, record: prior, evaluation };
  // the account's OWN root handle — the same device-side read the zk registration uses (the roster's handle for
  // the account's fid; lib/zk/registration.ts), falling back to the roster's persona grouping. Never a
  // persona → root question to the validator: the device names its own account, as it does for every root read.
  const { rootForFid, rootOfPersona } = await import("@/lib/identity/rootRoster");
  const { getSelf } = await import("@/lib/data");
  const rootId = (await rootForFid(getSelf().fid)) ?? (await rootOfPersona(own[0]));
  if (!rootId) return { ok: false, reason: "this device holds no root handle to accrue on" };
  let posted = false;
  if (evaluation.count > 0) {
    let res: Response;
    try {
      const { signedWriteHeaders } = await import("@/lib/adapters/mock/persist");
      const body = JSON.stringify({ rootId, type: "stewardship", count: evaluation.count, sourceId });
      res = await fetch(`${validatorUrl()}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await signedWriteHeaders("events", body)) },
        body,
        cache: "no-store",
      });
    } catch (e) {
      return { ok: false, reason: "validator unreachable: " + (e as Error).message };
    }
    if (!res.ok) return { ok: false, reason: `validator refused the accrual (${res.status})` };
    posted = true;
  }
  const record: AccrualRecord = { epoch: now, evaluatedEpoch, score: evaluation.score, count: evaluation.count, evaluated: evaluation.evaluated, confirmed: evaluation.confirmed, postedAt: Date.now(), sourceId };
  await recordAccrual(record);
  return { ok: true, posted, record, evaluation };
}
