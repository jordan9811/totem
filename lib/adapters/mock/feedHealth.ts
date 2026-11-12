import "server-only";
import { withMockLatency } from "../mockUtils";
import {
  AdapterError,
  type FeedHealthAdapter,
  type NoteReinjection,
  type ReadwiseSchedule,
  type SaturationEntry,
  type SendToTimelineEvent,
} from "../types";
import { SEED_NOTES, SEED_VIEWER, nextId, personaById, postByHash, state  } from "./store";

const CHUNK_TARGET_WORDS = 280;

/** Sentence-boundary-aware ~280-word chunker. */
export function chunkLongform(text: string, targetWords = CHUNK_TARGET_WORDS): string[] {
  // Split into sentences, keeping terminal punctuation. Paragraph breaks are
  // preserved as their own boundary so chunks don't straddle them awkwardly.
  const sentences = text
    .split(/\n\n+/)
    .flatMap((para) => {
      const parts = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [para];
      return parts.map((s) => s.trim()).filter(Boolean);
    })
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    // Close the chunk at a sentence boundary once we're at/over target.
    if (wordCount > 0 && wordCount + words > targetWords) {
      chunks.push(current.join(" "));
      current = [];
      wordCount = 0;
    }
    current.push(sentence);
    wordCount += words;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

const key = (personaId: string, postHash: string) => `${personaId}:${postHash}`;

export const mockFeedHealthAdapter: FeedHealthAdapter = {
  async scheduleReadwise(postHash, personaId, fullText, targetWords) {
    return withMockLatency(() => {
      const s = state();
      const k = key(personaId, postHash);
      const existing = s.readwise.get(k);
      if (existing) return existing;
      const schedule: ReadwiseSchedule = {
        postHash,
        personaId,
        chunks: chunkLongform(fullText, targetWords && targetWords > 0 ? targetWords : undefined),
        nextChunkIndex: 0,
        chunkSurfacedAt: [],
      };
      s.readwise.set(k, schedule);
      return schedule;
    }, { label: "feedHealth.scheduleReadwise" });
  },

  async getReadwiseSchedules(personaId) {
    return withMockLatency(
      () => [...state().readwise.values()].filter((r) => r.personaId === personaId),
      { label: "feedHealth.getReadwiseSchedules" }
    );
  },

  // POST-DEPLOY Gate 4: re-cut at a new width. The surfaced COUNT is preserved
  // proportionally rather than reset to zero — someone three chunks into a piece
  // who narrows the slider has still read that much of it, and putting them back
  // at the start would be the slider punishing them for touching it.
  async rechunkReadwise(postHash, personaId, targetWords) {
    return withMockLatency(() => {
      const s = state();
      const schedule = s.readwise.get(key(personaId, postHash));
      if (!schedule) return null;
      const source = postByHash.get(postHash);
      const full = source?.text ?? schedule.chunks.join(" ");
      const before = schedule.chunks.length || 1;
      const fraction = Math.min(1, schedule.nextChunkIndex / before);
      const chunks = chunkLongform(full, targetWords > 0 ? targetWords : undefined);
      schedule.chunks = chunks;
      schedule.nextChunkIndex = Math.min(chunks.length, Math.max(schedule.nextChunkIndex > 0 ? 1 : 0, Math.round(fraction * chunks.length)));
      schedule.chunkSurfacedAt = schedule.chunkSurfacedAt.slice(0, schedule.nextChunkIndex);
      return { ...schedule };
    }, { label: "feedHealth.rechunkReadwise" });
  },

  async advanceReadwise(postHash, personaId) {
    return withMockLatency(() => {
      const s = state();
      const schedule = s.readwise.get(key(personaId, postHash));
      if (!schedule) throw new AdapterError("no readwise schedule", "NOT_FOUND");
      if (schedule.nextChunkIndex < schedule.chunks.length) {
        schedule.chunkSurfacedAt[schedule.nextChunkIndex] = Date.now();
        schedule.nextChunkIndex += 1;
      }
      return schedule;
    }, { label: "feedHealth.advanceReadwise" });
  },

  async fastForwardAll(personaId) {
    return withMockLatency(() => {
      // Dev control: surface the next chunk of every active schedule at once.
      const schedules = [...state().readwise.values()].filter((r) => r.personaId === personaId);
      for (const schedule of schedules) {
        if (schedule.nextChunkIndex < schedule.chunks.length) {
          schedule.chunkSurfacedAt[schedule.nextChunkIndex] = Date.now();
          schedule.nextChunkIndex += 1;
        }
      }
      return schedules;
    }, { label: "feedHealth.fastForwardAll" });
  },

  async sendToTimeline(fromPersonaId, toPersonaId, postHash) {
    return withMockLatency(() => {
      const s = state();
      // Permission gate: receiver must allow inbound sends (default on).
      const allowed = s.receivePermission.get(toPersonaId) ?? true;
      if (!allowed) throw new AdapterError("recipient does not accept timeline sends", "FORBIDDEN");
      const event: SendToTimelineEvent = {
        id: nextId("send"),
        fromPersonaId,
        toPersonaId,
        postHash,
        createdAt: Date.now(),
      };
      s.sends.push(event);
      return event;
    }, { label: "feedHealth.sendToTimeline" });
  },

  async inboxFor(personaId) {
    return withMockLatency(() => {
      const s = state();
      const allowed = s.receivePermission.get(personaId) ?? true;
      // Permission off blocks receipt: nothing renders even if events exist.
      if (!allowed) return [];
      return s.sends.filter((e) => e.toPersonaId === personaId);
    }, { label: "feedHealth.inboxFor" });
  },

  async getReceivePermission(personaId) {
    return withMockLatency(() => state().receivePermission.get(personaId) ?? true, {
      label: "feedHealth.getReceivePermission",
    });
  },

  async setReceivePermission(personaId, allow) {
    return withMockLatency(() => {
      state().receivePermission.set(personaId, allow);
    }, { label: "feedHealth.setReceivePermission" });
  },

  async markCaughtUp(storyId, personaId, modeId) {
    return withMockLatency(() => {
      const entry: SaturationEntry = { storyId, personaId, caughtUpAt: Date.now(), modeId };
      const s = state();
      s.saturation = s.saturation.filter(
        (e) => !(e.storyId === storyId && e.personaId === personaId && e.modeId === modeId)
      );
      s.saturation.push(entry);
      return entry;
    }, { label: "feedHealth.markCaughtUp" });
  },

  async listSaturated(personaId, modeId) {
    return withMockLatency(
      () => state().saturation.filter((e) => e.personaId === personaId && (e.modeId === null || e.modeId === modeId)),
      { label: "feedHealth.listSaturated" }
    );
  },

  async clearSaturation(storyId, personaId) {
    return withMockLatency(() => {
      const s = state();
      s.saturation = s.saturation.filter((e) => !(e.storyId === storyId && e.personaId === personaId));
    }, { label: "feedHealth.clearSaturation" });
  },

  async reinjectionsFor(personaId) {
    // MEGA PASS 2 Gate 1: STAKE-BACKED ENDORSEMENTS — distinct `note-worthy` stakers on a noted post count toward
    // the two-endorsement gate (one public read per build; additive, so an unreadable stake store adds nothing)
    let backed = new Map<string, number>();
    try {
      const { recentStakes, noteWorthyStakersByCast } = await import("@/lib/influence/stakes");
      backed = noteWorthyStakersByCast(await recentStakes(3));
    } catch {
      backed = new Map();
    }
    return withMockLatency(() => {
      const s = state();
      const out: NoteReinjection[] = [];
      for (const note of SEED_NOTES) {
        // Only reinject on posts this viewer engaged with (liked).
        if (!s.likes.has(note.postHash)) continue;
        const author = personaById.get(note.authorPersonaId);
        const tier = author?.tier ?? 1;
        // Gate: note author tier >= 3 AND 2+ endorsements.
        const tierOk = tier >= 3;
        const backedBy = backed.get(note.postHash) ?? 0;
        const endorsements = note.endorsements + backedBy;
        const endorseOk = endorsements >= 2;
        const qualifies = tierOk && endorseOk;
        out.push({
          postHash: note.postHash,
          noteId: note.id,
          personaId,
          qualifies,
          reason: qualifies
            ? `note author tier ${tier} ≥ 3 and ${endorsements} endorsements ≥ 2${backedBy ? ` (${backedBy} stake-backed)` : ""}`
            : !tierOk
              ? `note author tier ${tier} below required 3`
              : `only ${endorsements} endorsement${endorsements === 1 ? "" : "s"}, needs 2`,
        });
      }
      return out;
    }, { label: "feedHealth.reinjectionsFor" });
  },
};
