import "server-only";
// EventLogAdapter, mock implementation. Validator SQLite holds it via the
// persistence wrapper for now; the contract is shaped so an encrypted vault
// can take it later without schema change.
import { withMockLatency } from "../mockUtils";
import { AdapterError } from "../types";
import type { EventLogAdapter } from "../types";
import { isEdgeEventType, type EdgeEvent } from "@/lib/eventlog/types";
import { state } from "./store";

/** Words that must never appear in an event type. Defense in depth behind the
 * closed union: even a caller that defeats the type system gets refused at
 * the write path, loudly. */
const FORBIDDEN = /view|impression|dwell|seen|scroll/i;

export const mockEventLogAdapter: EventLogAdapter = {
  async record(event) {
    return withMockLatency(() => {
      if (!isEdgeEventType(event.type) || FORBIDDEN.test(event.type)) {
        // Not a silent drop. An unrepresentable event arriving here means a
        // caller is trying to log something the model forbids — that is a
        // bug to surface, not data to quietly discard.
        throw new AdapterError(
          `event type "${String(event.type)}" is not representable in the relationship log`,
          "FAILED"
        );
      }
      if (!event.id || !event.actorPersonaId || !event.targetPersona) {
        throw new AdapterError("event missing id/actor/target", "FAILED");
      }
      const s = state();
      // Idempotent put-by-id: the route minted the id once, so a retried
      // write lands on the same key and exactly-one holds.
      if (!s.edgeEvents.has(event.id)) s.edgeEvents.set(event.id, { ...event });
      return s.edgeEvents.get(event.id)!;
    }, { label: "eventLog.record" });
  },

  async list(actorPersonaId) {
    return withMockLatency(
      () =>
        [...state().edgeEvents.values()]
          .filter((e) => e.actorPersonaId === actorPersonaId)
          .sort((a, b) => b.timestamp - a.timestamp),
      { label: "eventLog.list" }
    );
  },

  async forTarget(actorPersonaId, targetPersona) {
    return withMockLatency(
      () =>
        [...state().edgeEvents.values()]
          .filter((e) => e.actorPersonaId === actorPersonaId && e.targetPersona === targetPersona)
          .sort((a, b) => a.timestamp - b.timestamp),
      { label: "eventLog.forTarget" }
    );
  },
};
