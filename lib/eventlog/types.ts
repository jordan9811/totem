// THE RELATIONSHIP EVENT LOG — the record of why your graph looks the way
// it does. Every day this isn't logging is history that can never be
// recovered, which is why this gate ships first in the pass.
//
// THE CONSTRAINT THAT DEFINES THIS FILE: the log contains only actions the
// user TOOK. There is no view event, no impression event, no dwell-time
// event, and no way to represent one — the type union below is closed, the
// adapter's write path rejects anything off it at runtime, and a test greps
// this file to keep it that way. A relationship log that also logged what
// you merely looked at would be the surveillance it exists to replace.

/** Every representable event. Closed union — additions are a design decision,
 * not a convenience. NO view/impression/dwell type may ever appear here. */
export const EDGE_EVENT_TYPES = [
  // graph edges
  "follow",
  "unfollow",
  "block",
  "unblock",
  "mute",
  "unmute",
  "facet_follow",
  "facet_unfollow",
  // moderation (the 3-strike path, when it exists)
  "strike",
  // the user's own interactions — consultable so co-interaction works
  "reply",
  "like",
  // derived pair: earliest own-interaction with an account later followed
  "first_interaction",
  // Tier B Gate 2: publishing a copy to an external destination. An ACTION
  // the user took — the closed-union rule exists to bar records of passive
  // exposure, and publishing is the opposite of passive.
  "crosspost",
  // UX Gate 1: act-as-any-persona. Quoting is new authored content (same
  // standing as reply); recast previously logged nothing at all even
  // outside act-as — both are things the user DID, not passive exposure.
  "quote",
  "recast",
] as const;

export type EdgeEventType = (typeof EDGE_EVENT_TYPES)[number];

/** Which surface the action happened on. Free-form but conventionally one of:
 * profile, cast_menu, timeline, settings, thread, search, backfill. */
export type EdgeContext = string;

export interface EdgeEvent {
  id: string;
  type: EdgeEventType;
  /** whose log this is — always the acting user's persona */
  actorPersonaId: string;
  targetPersona: string;
  /** the cast that triggered the action, when one did */
  triggeringCastId: string | null;
  /** surface the action happened on */
  context: EdgeContext;
  timestamp: number;
  /** synthetic origin event derived from seed data, not a real action */
  backfilled?: boolean;
  /** crosspost events: the destination's reference for the published copy */
  externalRef?: string;
  /** UX Gate 1: this action was taken through the act-as picker — the
   * acting persona (above) differs from whatever persona was ACTIVE at the
   * time. Traceability, not a distinct action type. */
  viaActAs?: boolean;
}

export function isEdgeEventType(t: unknown): t is EdgeEventType {
  return typeof t === "string" && (EDGE_EVENT_TYPES as readonly string[]).includes(t);
}
