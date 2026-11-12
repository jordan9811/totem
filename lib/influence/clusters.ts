// MEGA PASS 2 Gate 1 — COORDINATED STAKING IS DETECTABLE, NOT ENFORCED.
//
// Legibility over enforcement: nothing here refuses, weights or punishes.
// Per-persona stake rows are public, so any lens that wants to weight
// against coordination can — and this is the plain arithmetic it would
// use. A cluster is a set of ≥ MIN_MEMBERS personas who each staked the
// SAME direction on ≥ MIN_SHARED of the same casts in one epoch. Pure;
// runs on the public rows the validator serves.
import type { StakeDirection, StakeEvent } from "./types";

export const MIN_MEMBERS = 3;
export const MIN_SHARED = 3;

export interface StakeCluster {
  epoch: number;
  direction: StakeDirection;
  members: string[];
  casts: string[];
  /** total staked by the cluster on its shared casts */
  amount: number;
}

export function detectClusters(rows: StakeEvent[]): StakeCluster[] {
  // (epoch, direction) → persona → set of casts
  const byKey = new Map<string, Map<string, Set<string>>>();
  const amounts = new Map<string, number>(); // key|persona|cast → amount
  for (const r of rows) {
    const key = `${r.epoch}|${r.direction}`;
    const personas = byKey.get(key) ?? new Map<string, Set<string>>();
    const casts = personas.get(r.personaId) ?? new Set<string>();
    casts.add(r.castHash);
    personas.set(r.personaId, casts);
    byKey.set(key, personas);
    const ak = `${key}|${r.personaId}|${r.castHash}`;
    amounts.set(ak, (amounts.get(ak) ?? 0) + r.amount);
  }
  const out: StakeCluster[] = [];
  for (const [key, personas] of byKey) {
    const [epochStr, direction] = key.split("|") as [string, StakeDirection];
    const ids = [...personas.keys()].sort();
    // adjacency: two personas are linked when they share ≥ MIN_SHARED casts
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = personas.get(ids[i])!;
        const b = personas.get(ids[j])!;
        let shared = 0;
        for (const c of a) if (b.has(c)) shared++;
        if (shared >= MIN_SHARED) {
          (adj.get(ids[i]) ?? adj.set(ids[i], new Set()).get(ids[i])!).add(ids[j]);
          (adj.get(ids[j]) ?? adj.set(ids[j], new Set()).get(ids[j])!).add(ids[i]);
        }
      }
    }
    // connected components of size ≥ MIN_MEMBERS
    const seen = new Set<string>();
    for (const start of ids) {
      if (seen.has(start) || !adj.has(start)) continue;
      const comp: string[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
      if (comp.length < MIN_MEMBERS) continue;
      // the casts every member shares with at least one other member
      const castCount = new Map<string, number>();
      for (const m of comp) for (const c of personas.get(m)!) castCount.set(c, (castCount.get(c) ?? 0) + 1);
      const casts = [...castCount].filter(([, n]) => n >= 2).map(([c]) => c).sort();
      let amount = 0;
      for (const m of comp) for (const c of casts) amount += amounts.get(`${key}|${m}|${c}`) ?? 0;
      out.push({ epoch: Number(epochStr), direction, members: comp.sort(), casts, amount });
    }
  }
  return out.sort((a, b) => b.members.length - a.members.length || b.amount - a.amount);
}
