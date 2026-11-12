import "server-only";
// THE 3-STRIKE PATH — the moderation half of the relationship log.
//
// A strike is a receipt: it names the cast that earned it and the surface it
// was issued from. Three strikes against the same account, with the per-user
// toggle ON, auto-mute that account — and the profile history shows all
// three receipts, because a mute you cannot explain is a mute you will not
// trust. Muting hides the account from feeds; it is softer than a block (no
// sibling fan-out, no interaction bar) and entirely derived — clearing
// strikes or disabling the toggle unmutes on the next render.
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { state, persistNs } from "@/lib/adapters/mock/store";
import { logEdgeEvent } from "./log";
import type { EdgeEvent } from "./types";

export const STRIKE_THRESHOLD = 3;

export function strikeSettingFor(personaId: string): { enabled: boolean } {
  return state().strikeSettings.get(personaId) ?? { enabled: false };
}

export async function setStrikeSetting(personaId: string, enabled: boolean): Promise<void> {
  state().strikeSettings.set(personaId, { enabled });
  await persistNs("strikeSettings");
}

/** Issue one strike. The receipt (triggering cast) is required — a strike
 * with no receipt is a mood, not a record. */
export async function issueStrike(input: {
  actorPersonaId: string;
  targetPersona: string;
  triggeringCastId: string;
  context: string;
}): Promise<{ event: EdgeEvent; strikes: number; muted: boolean }> {
  const event = await logEdgeEvent({ type: "strike", ...input });
  const strikes = await strikesAgainst(input.actorPersonaId, input.targetPersona);
  const muted =
    strikeSettingFor(input.actorPersonaId).enabled && strikes.length >= STRIKE_THRESHOLD;
  if (muted) {
    // The mute is an edge event too — the log records what the system did
    // on the user's behalf, with context naming why.
    const already = (
      await retryAdapter(() => adapters.eventLog.forTarget(input.actorPersonaId, input.targetPersona))
    ).some((e) => e.type === "mute" && e.context === "three_strikes");
    if (!already) {
      await logEdgeEvent({
        type: "mute",
        actorPersonaId: input.actorPersonaId,
        targetPersona: input.targetPersona,
        triggeringCastId: input.triggeringCastId,
        context: "three_strikes",
      });
    }
  }
  return { event, strikes: strikes.length, muted };
}

export async function strikesAgainst(actor: string, target: string): Promise<EdgeEvent[]> {
  const events = await retryAdapter(() => adapters.eventLog.forTarget(actor, target));
  return events.filter((e) => e.type === "strike");
}

/** Accounts muted for this viewer via the 3-strike path. Derived, never
 * persisted as a mute list: toggling the setting off un-mutes everything on
 * the next render, receipts intact. */
export async function threeStrikeMuted(actorPersonaId: string): Promise<Set<string>> {
  if (!strikeSettingFor(actorPersonaId).enabled) return new Set();
  const all = await retryAdapter(() => adapters.eventLog.list(actorPersonaId));
  const counts = new Map<string, number>();
  for (const e of all) {
    if (e.type !== "strike") continue;
    counts.set(e.targetPersona, (counts.get(e.targetPersona) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= STRIKE_THRESHOLD).map(([t]) => t));
}
