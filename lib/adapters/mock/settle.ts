import "server-only";
import { withMockLatency } from "../mockUtils";
import type { SettleAdapter, SettlementEvent } from "../types";
import graphRaw from "@/seed/data/graph.json";
import { absoluteTime, nextId, state } from "./store";
import { bank } from "@/lib/world";

// LAYERS_WORLD=empty (lib/world.ts): no seeded settlements
const SEED_SETTLEMENTS = bank(graphRaw.settlements as (Omit<SettlementEvent, "createdAt"> & {
  minutesAgo: number;
})[], []).map((e) => ({
  id: e.id,
  kind: e.kind,
  personaId: e.personaId,
  amount: e.amount,
  category: e.category,
  note: e.note,
  createdAt: absoluteTime(e.minutesAgo),
})) as SettlementEvent[];

function allEvents(personaId: string): SettlementEvent[] {
  const seeded = SEED_SETTLEMENTS.filter((e) => e.personaId === personaId);
  const live = state().settlements.filter((e) => e.personaId === personaId);
  return [...seeded, ...live];
}

export const mockSettleAdapter: SettleAdapter = {
  async listEvents(personaId) {
    return withMockLatency(
      () => allEvents(personaId).sort((a, b) => b.createdAt - a.createdAt),
      { label: "settle.listEvents" }
    );
  },

  async record(event) {
    return withMockLatency(() => {
      const { recordId, ...body } = event as typeof event & { recordId?: string };
      if (recordId) {
        // put-by-id: same id converges to the SAME record. The Tier B
        // known-limitation (records lost when the write fails persistently
        // after the ledger resolved) closes here: the caller retries with
        // the same derived id and gets exactly one record.
        const existing = state().settlements.find((e) => e.id === recordId);
        if (existing) return existing;
        const created: SettlementEvent = { ...body, id: recordId, createdAt: Date.now() };
        state().settlements.push(created);
        return created;
      }
      const created: SettlementEvent = { ...body, id: nextId("settle"), createdAt: Date.now() };
      state().settlements.push(created);
      return created;
    }, { label: "settle.record" });
  },

  // Per-category breakdown. Totals must equal the exact sum of events —
  // acceptance criterion 9 asserts equality, so no rounding anywhere here.
  async earningsByCategory(personaId) {
    return withMockLatency(() => {
      const totals = new Map<string, number>();
      for (const e of allEvents(personaId)) {
        totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
      }
      return [...totals.entries()]
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total);
    }, { label: "settle.earningsByCategory" });
  },

  async total(personaId) {
    return withMockLatency(
      () => allEvents(personaId).reduce((sum, e) => sum + e.amount, 0),
      { label: "settle.total" }
    );
  },
};
