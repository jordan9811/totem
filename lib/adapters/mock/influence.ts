import "server-only";
// MEGA PASS 2 Gate 1 — the InfluenceAdapter. A thin seam over
// lib/influence: allowance (vault), stakes (signed, per-persona, on the
// validator), history (disclosure-gated), per-cast summaries. The contract
// in lib/adapters/types.ts has NO transfer method — see the type-level
// assertion in lib/influence/types.ts and the Gate 1 suite's grep.
import { withMockLatency } from "../mockUtils";
import type { InfluenceAdapter } from "../types";

export const mockInfluenceAdapter: InfluenceAdapter = {
  async allowance() {
    const { currentAllowance, stakeSettings } = await import("@/lib/influence/allowance");
    return withMockLatency(async () => {
      const [balance, settings] = await Promise.all([currentAllowance(), stakeSettings()]);
      return { ...balance, defaults: settings.defaults, directions: settings.directions };
    }, { label: "influence.allowance" });
  },

  async stake(input) {
    const { placeStake } = await import("@/lib/influence/stakes");
    return withMockLatency(() => placeStake(input), { label: "influence.stake" });
  },

  async historyFor(personaId, viewerPersonaId) {
    const { historyFor } = await import("@/lib/influence/stakes");
    return withMockLatency(() => historyFor(personaId, viewerPersonaId), { label: "influence.historyFor" });
  },

  async stakesForCast(castHash) {
    const { stakesForCast, summarize } = await import("@/lib/influence/stakes");
    return withMockLatency(async () => {
      const rows = await stakesForCast(castHash);
      const { emptySummary } = await import("@/lib/influence/types");
      return { rows, summary: summarize(rows).get(castHash) ?? emptySummary() };
    }, { label: "influence.stakesForCast" });
  },

  async setSettings(patch) {
    const { setStakeSettings } = await import("@/lib/influence/allowance");
    return withMockLatency(() => setStakeSettings(patch), { label: "influence.setSettings" });
  },
};
