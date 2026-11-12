// ANON REVIEW (R1-04) — the validator gives an anon post NO epoch grace (a window-boundary nullifier would let a second
// post through), but the client draws the submission moment UNIFORMLY in [now + jitterMin, now + jitterMax] and the
// epoch clamp in lib/zk/anon/queue.ts never binds (it allows half an epoch past the boundary). So a proof made in the
// last jitterMax of an epoch could be sent in the next one and refused, silently. The tick therefore DEFERS an anon
// proof whose epoch has less than jitterMax + margin left (the proof itself can take up to the live prover's timeout,
// hence the margin), and proves it on the next tick, from the next epoch's snapshot. Pure; the harness imports it.

/** the slack after the jitter window: the live prover's 180 s ceiling, the drain's 5 s cadence, and clock drift */
export const ZK_ANON_EPOCH_EDGE_MARGIN_MS = Math.max(0, Math.min(3_600_000, Number(process.env.ZK_ANON_EPOCH_EDGE_MARGIN_MS ?? 300_000) || 300_000));

export interface EpochEdgeVerdict {
  /** true: do not prove now — keep the post wanted for the next tick */
  defer: boolean;
  /** what is left of the snapshot's epoch at `now` */
  remainingMs: number;
  /** jitterMax + margin */
  neededMs: number;
}

export function anonEpochEdge(snapshot: { msRemaining: number; fetchedAt: number }, now: number, jitterMaxMs: number, marginMs: number = ZK_ANON_EPOCH_EDGE_MARGIN_MS): EpochEdgeVerdict {
  const elapsed = Math.max(0, now - snapshot.fetchedAt);
  const remainingMs = snapshot.msRemaining - elapsed;
  const neededMs = Math.max(0, jitterMaxMs) + Math.max(0, marginMs);
  return { defer: remainingMs < neededMs, remainingMs, neededMs };
}
