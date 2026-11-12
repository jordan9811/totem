// ANON REVIEW (A2-2, R3-02) — a per-cast OUTCOME LOG for anonymous posts, so a refusal is never silent.
//
// Before this, the composer toasted "Queued anonymously" on the 202 and nothing ever reported what the tick did: a
// proof refused at the cohort, the membership or the snapshot stage left no queue item, the wanted entry was gone, and
// GET /api/anon?castHash= answered "unknown". Now every stage a post passes through — wanted, deferred (epoch edge),
// retrying, queued, dropped — is written here with its reason, and the status read merges it with the queue item.
//
// IN MEMORY, on purpose: the wanted set it describes is in memory too, and persisting it would be one more
// identified write keyed by the moment of composition (the beacon R1-01 removed). A restart forgets both; the status
// read then says so ("no record on this server") instead of inventing a state. Bounded to the last 100 posts.

export type AnonStage = "wanted" | "deferred" | "retrying" | "queued" | "dropped";

export interface AnonOutcome {
  castHash: string;
  mode: "fixture" | "live";
  stage: AnonStage;
  /** the last tick's refusal reason while retrying, or the terminal reason when dropped */
  reason: string | null;
  /** which prove stage last refused (prove.ts ProveStage, "snapshot", "epoch-edge", "relay", "window") */
  lastStage: string | null;
  /** proof attempts so far (a deferral does not count) */
  attempts: number;
  firstAt: number;
  lastAt: number;
  /** set once the proof is queued */
  queuedId: string | null;
  epoch: number | null;
  /** compose-time warnings about the text (mentions, links) */
  warnings: string[];
  /** PERSONA LAUNCH wave 3 (UXH-1): an X copy's persona (device-local, in memory like the rest of the log) — the X view
   *  shows a copy's log to a scope that may see that persona only (lib/x/outbox/request.ts), so a dropped sibling copy,
   *  whose sealed record is gone, still never shows through a compartment */
  personaId?: string | null;
}

const MAX = 100;
const g = globalThis as unknown as { __layersAnonOutcomes?: Map<string, AnonOutcome> };
const store = (): Map<string, AnonOutcome> => (g.__layersAnonOutcomes ??= new Map());

export function noteAnonOutcome(castHash: string, mode: "fixture" | "live", patch: Partial<Omit<AnonOutcome, "castHash" | "mode" | "firstAt" | "lastAt">>): AnonOutcome {
  const s = store();
  const now = Date.now();
  const prev = s.get(castHash);
  const next: AnonOutcome = prev
    ? { ...prev, ...patch, lastAt: now }
    : { castHash, mode, stage: "wanted", reason: null, lastStage: null, attempts: 0, firstAt: now, lastAt: now, queuedId: null, epoch: null, warnings: [], ...patch };
  s.delete(castHash);
  s.set(castHash, next);
  while (s.size > MAX) {
    const oldest = s.keys().next().value;
    if (oldest === undefined) break;
    s.delete(oldest);
  }
  return next;
}

export function anonOutcome(castHash: string): AnonOutcome | null {
  return store().get(castHash) ?? null;
}

export function anonOutcomes(): AnonOutcome[] {
  return [...store().values()];
}

/** resetSeed / resetZk: forget the log with the universe it describes (PERSONA LAUNCH P8: the X copies' log too — their
 *  wanted entries live in the same wanted set, which the same resets clear) */
export function resetAnonOutcomes(mode?: "fixture" | "live"): void {
  if (!mode) {
    store().clear();
    xStore().clear();
    return;
  }
  for (const [k, v] of [...store().entries()]) if (v.mode === mode) store().delete(k);
  for (const [k, v] of [...xStore().entries()]) if (v.mode === mode) xStore().delete(k);
}

// ---------------------------------------------------------------- PERSONA LAUNCH P8: the X copies' own log
// The same stages for an anonymous X copy ("also post to @totem on X"), keyed by its xHash, in a map of its own: an X
// copy and its Farcaster sibling are two posts with two fates, and GET /api/anon?castHash= must never answer for an X
// copy. In memory and bounded like the anon log, for the same reason (persisting it would be a compose-time write).
const gx = globalThis as unknown as { __layersXOutcomes?: Map<string, AnonOutcome> };
const xStore = (): Map<string, AnonOutcome> => (gx.__layersXOutcomes ??= new Map());

export function noteXOutcome(xHash: string, mode: "fixture" | "live", patch: Partial<Omit<AnonOutcome, "castHash" | "mode" | "firstAt" | "lastAt">>): AnonOutcome {
  const s = xStore();
  const now = Date.now();
  const prev = s.get(xHash);
  const next: AnonOutcome = prev
    ? { ...prev, ...patch, lastAt: now }
    : { castHash: xHash, mode, stage: "wanted", reason: null, lastStage: null, attempts: 0, firstAt: now, lastAt: now, queuedId: null, epoch: null, warnings: [], ...patch };
  s.delete(xHash);
  s.set(xHash, next);
  while (s.size > MAX) {
    const oldest = s.keys().next().value;
    if (oldest === undefined) break;
    s.delete(oldest);
  }
  return next;
}
export function xOutcome(xHash: string): AnonOutcome | null {
  return xStore().get(xHash) ?? null;
}
