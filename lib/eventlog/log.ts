import "server-only";
// The one way anything writes to the relationship log.
//
// Routes call logEdgeEvent() and nothing else. The id is DERIVED, not random,
// so a retried write — the in-process retryAdapter around record() OR a
// client-level HTTP retry of the whole POST — lands on the SAME key, and the
// adapter's idempotent put-by-id keeps exactly one event.
//
// How the id is derived (deriveId below):
//   1. An explicit caller-supplied idempotencyKey wins for ANY type. This is
//      the lib/x/spend.ts model: a client that mints one key per user-action
//      and reuses it on retry gets exactly-one for that action, and two
//      genuinely-distinct actions stay distinct. It is also the ONLY way to
//      make a countable action (a second reply to the same cast) retry-safe.
//   2. State-establishing EDGE actions (follow, block, mute, facet, crosspost,
//      first_interaction, …) derive the id from content, so even a naive HTTP
//      retry with no client key collapses to one event. Repeating "follow X"
//      is naturally idempotent — the edge either exists or it does not.
//   3. Everything else — the countable/authored actions (reply, like, quote,
//      recast, strike) — gets a fresh id per call, because a second reply to
//      the same parent is a real second action, not a retry. A client that
//      wants those deduped supplies a key and takes branch 1.
//
// The one honest limitation of branch 2: a rapid re-follow after an unfollow
// from the identical surface collapses onto the first follow's receipt (the
// original origin is kept). That loses no invariant — co-interaction needs
// only the earliest interaction, and strikes are keyed by their cast — and a
// caller that needs the second receipt distinct supplies an idempotencyKey.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { SEED_VIEWER, state, persistNs } from "@/lib/adapters/mock/store";
import type { EdgeEvent, EdgeEventType } from "./types";

/** Event types whose meaning is "this edge exists" — repeating the action is
 * naturally idempotent, so their id is content-derived and a retry (in-process
 * OR a client HTTP retry) collapses to one event. The countable/authored
 * actions (reply, like, quote, recast, strike) are deliberately NOT here. */
const IDEMPOTENT_EDGE_TYPES: ReadonlySet<EdgeEventType> = new Set<EdgeEventType>([
  "follow",
  "unfollow",
  "block",
  "unblock",
  "mute",
  "unmute",
  "facet_follow",
  "facet_unfollow",
  "crosspost",
  "first_interaction",
]);

function hashedId(seed: string): string {
  return "ev_" + createHash("sha256").update(seed).digest("hex").slice(0, 20);
}

/** Derive the event id per the three-branch rule documented at the top of the
 * file. Disjoint seed prefixes ("key|" vs "content|") keep the client-key and
 * content-derived id spaces from ever colliding. */
function deriveId(input: LogInput): string {
  if (input.idempotencyKey) return hashedId("key|" + input.idempotencyKey);
  if (IDEMPOTENT_EDGE_TYPES.has(input.type)) {
    return hashedId(
      [
        "content",
        input.type,
        input.actorPersonaId,
        input.targetPersona,
        input.triggeringCastId ?? "",
        input.context,
      ].join("|")
    );
  }
  // Countable/authored action: a fresh id every call.
  return "ev_" + createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 20);
}

export interface LogInput {
  type: EdgeEventType;
  actorPersonaId: string;
  targetPersona: string;
  triggeringCastId?: string | null;
  context: string;
  /** Idempotency key for this write. When set, the event id is derived from it
   * (branch 1 of deriveId) — the way to make a client-level HTTP retry, or a
   * countable action, collapse to exactly one event. Routes read it from the
   * request via eventIdempotencyKey(). */
  idempotencyKey?: string;
  backfilled?: boolean;
  /** crosspost events: the destination's ref for the published copy */
  externalRef?: string;
  /** act-as events: acting persona differs from whatever was active */
  viaActAs?: boolean;
  /** test hook only — real callers never set time */
  timestamp?: number;
}

/** Record one event. Throws loudly if the log cannot be written: an edge
 * action whose history silently failed to record is unrecoverable, which is
 * the exact loss this gate exists to stop. */
export async function logEdgeEvent(input: LogInput): Promise<EdgeEvent> {
  const event: EdgeEvent = {
    id: deriveId(input),
    type: input.type,
    actorPersonaId: input.actorPersonaId,
    targetPersona: input.targetPersona,
    triggeringCastId: input.triggeringCastId ?? null,
    context: input.context,
    timestamp: input.timestamp ?? Date.now(),
    ...(input.backfilled ? { backfilled: true } : {}),
    ...(input.externalRef ? { externalRef: input.externalRef } : {}),
    ...(input.viaActAs ? { viaActAs: true } : {}),
  };
  const recorded = await retryAdapter(() => adapters.eventLog.record(event));
  await persistNs("edgeEvents");
  return recorded;
}

/** The caller-supplied idempotency key for an event-log write, if any — read
 * from the `Idempotency-Key` header first, then a body `idempotencyKey` field,
 * so either transport works. Honored for ANY event type (branch 1 of
 * deriveId): the escape hatch that makes even a countable action (a second
 * reply, a re-like) retry-safe when a client mints one key per user-action and
 * reuses it on retry. Returns undefined when none was supplied, leaving the
 * content-derived / fresh-id defaults in force. */
export function eventIdempotencyKey(
  req: { headers: Headers },
  body?: Record<string, unknown> | null
): string | undefined {
  const header = req.headers.get("idempotency-key");
  if (header && header.trim()) return header.trim();
  const field = body?.idempotencyKey;
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

// ---------------------------------------------------------------- following

/** The live following set: seed baseline plus persisted runtime deltas.
 * Feed, tests and the follow route all read THIS — one source of truth. */
export function followingFor(_actorPersonaId: string): Set<string> {
  const s = state();
  const out = new Set(SEED_VIEWER.followingPersonaIds);
  for (const id of s.followAdded) out.add(id);
  for (const id of s.followRemoved) out.delete(id);
  return out;
}

export async function setFollowing(target: string, follow: boolean): Promise<void> {
  const s = state();
  if (follow) {
    s.followAdded.add(target);
    s.followRemoved.delete(target);
  } else {
    s.followRemoved.add(target);
    s.followAdded.delete(target);
  }
  await persistNs("followDeltas");
}

// ------------------------------------------------------------ co-interaction

/**
 * Resolve a first-interaction pair, from OWN action history only.
 *
 * Called from two directions so "later" and "already" both work:
 *  - on FOLLOW: the earliest recorded own reply/like targeting the newly
 *    followed account becomes the pair's origin
 *  - on REPLY/LIKE: if the author is already followed and no pair exists yet,
 *    this interaction is the origin
 *
 * Nothing here consults anyone else's behaviour, and nothing here consults
 * what was merely seen — only reply/like events the user produced.
 */
export async function resolveFirstInteraction(
  actorPersonaId: string,
  targetPersona: string,
  context: string
): Promise<EdgeEvent | null> {
  const events = await retryAdapter(() => adapters.eventLog.forTarget(actorPersonaId, targetPersona));
  if (events.some((e) => e.type === "first_interaction")) return null; // already resolved
  const earliest = events.find((e) => e.type === "reply" || e.type === "like");
  if (!earliest) return null;
  return logEdgeEvent({
    type: "first_interaction",
    actorPersonaId,
    targetPersona,
    triggeringCastId: earliest.triggeringCastId,
    context,
  });
}

// ---------------------------------------------------------------- backfill

/**
 * Synthetic origin events for the seeded following graph, marked
 * `backfilled: true` so the UI can always distinguish "we know why" from
 * "this edge predates the log". Idempotent: keyed events, checked by marker.
 */
export async function backfillSeededFollows(actorPersonaId: string): Promise<number> {
  const s = state();
  const already = [...s.edgeEvents.values()].some(
    (e) => e.actorPersonaId === actorPersonaId && e.backfilled
  );
  if (already) return 0;
  // Direct store writes, matching how seedGrantGraph seeds grants: this is
  // seeding, not a user action, and routing 14 rows through the adapter's
  // 200-1500ms injected latency would make every seed reset take ~20s.
  let n = 0;
  for (const target of SEED_VIEWER.followingPersonaIds) {
    const event: EdgeEvent = {
      // deterministic id so repeated backfills collapse to the same rows
      id: "ev_bf_" + createHash("sha256").update(actorPersonaId).update(target).digest("hex").slice(0, 16),
      type: "follow",
      actorPersonaId,
      targetPersona: target,
      triggeringCastId: null,
      context: "backfill",
      timestamp: 0, // before all real events, honestly labelled by the flag
      backfilled: true,
    };
    if (!s.edgeEvents.has(event.id)) {
      s.edgeEvents.set(event.id, event);
      n++;
    }
  }
  if (n) await persistNs("edgeEvents");
  return n;
}
