import { NextRequest, NextResponse } from "next/server";
// POST-DEPLOY Gate 4 — READWISE: the knobs, the dwell mechanic, the bin.
//
// GET                                     the active mode knobs, the priority folders, progress, the bin
// POST {action:"knobs", perBuild?, chunkWords?[, modeId][, rechunk]}
// POST {action:"priorityFolder", folderId, on}
// POST {action:"dwell", chunkId, ms}      accumulate time on a chunk; crossing the length-scaled threshold marks it read
// POST {action:"bury", chunkId}           X-ing out a chunk BURIES it — it is never deleted
// POST {action:"restore", chunkId}        get it back out of the bin
//
// DWELL NEVER TOUCHES AN ADAPTER. It is written straight into the sealed vault
// record by lib/readwise/state.ts: no adapter method takes a dwell value, so no
// adapter payload can carry one, and the suite greps the interface to prove it.
//
// There is no retention model here and there is not meant to be one. The
// threshold is words divided by a reading rate with a floor, and that is the
// whole of it.
//
// SPEC C — READING PIECES ON THE REAL FOLLOWING: a long Farcaster post, or one
// with a link, is ONE piece, "<cast hash>#chunk1". dwell, bury and threshold
// take it like a sample chunk, into the same sealed record; its text is the cast
// this browser already holds for the Following (never read from Farcaster's node
// for this, never taken from the request). While a persona acts these refuse
// 409 acting_persona, nothing written.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import {
  DEFAULTS,
  LIMITS,
  READ_WPM,
  DWELL_FLOOR_MS,
  binEntries,
  bury,
  chunkIdOf,
  dwellThresholdMs,
  knobsFor,
  priorityFolders,
  progressFor,
  recordDwell,
  restore,
  setKnobs,
  setPriorityFolder,
} from "@/lib/readwise/state";

export const dynamic = "force-dynamic";

/** SPEC C: a reading piece on the real Following ("<Farcaster cast hash>#chunk1") — a Farcaster post is ONE piece */
const HUB_PIECE_RE = /^(0x[0-9a-f]{40})#chunk1$/;

/** SPEC C: the root acts as a persona — a hub piece's dwell or bin entry is never written from a persona's tab */
class HubPieceRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HubPieceRefused";
  }
}

/** the chunk text, found from the schedules — the threshold is a function of it. SPEC C: a hub piece's text is the cast
 *  this browser HOLDS for the Following (lib/fc/hubRead/read.ts hubHeldPiece: never a read of Farcaster's node, never a
 *  text the caller hands in; a cast not held is an unknown chunk) */
async function chunkTextOf(personaId: string, chunkId: string): Promise<{ text: string; postHash: string; index: number } | null> {
  const hub = HUB_PIECE_RE.exec(chunkId);
  if (hub) {
    const { HubReadError, hubHeldPiece } = await import("@/lib/fc/hubRead/read");
    try {
      const held = await hubHeldPiece(hub[1]);
      return held ? { text: held.text, postHash: hub[1], index: 1 } : null;
    } catch (e) {
      if (e instanceof HubReadError && e.code === "acting_persona") throw new HubPieceRefused(409, e.code, e.message);
      if (e instanceof HubReadError && e.code === "device_only") return null;
      throw e;
    }
  }
  const m = chunkId.match(/^(.*)#chunk(\d+)$/);
  if (!m) return null;
  const [, postHash, n] = m;
  const index = Number(n);
  const schedules = await retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId));
  const sch = schedules.find((x) => x.postHash === postHash);
  if (!sch || index < 1 || index > sch.chunks.length) return null;
  return { text: sch.chunks[index - 1], postHash, index };
}

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const active = await retryAdapter(() => adapters.mode.getActive(personaId));
    const schedules = await retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId));
    const folders = await retryAdapter(() => adapters.space.listFolders(personaId));
    const prio = await priorityFolders();
    const hubActing = await personaActsHere();
    return NextResponse.json({
      mode: { id: active.id, name: active.name },
      knobs: await knobsFor(active.id),
      defaults: DEFAULTS,
      limits: LIMITS,
      dwell: { wpm: READ_WPM, floorMs: DWELL_FLOOR_MS },
      priorityFolders: prio,
      folders: folders.map((f) => ({ id: f.id, name: f.name, posts: f.postHashes.length, priority: prio.includes(f.id) })),
      // ROOT-SCOPED BY CONSTRUCTION: the dwell map is keyed by chunk, not by
      // (persona, chunk), so this answer is the same whichever persona asks.
      progress: await progressFor(schedules.map((s) => ({ postHash: s.postHash, chunks: s.chunks }))),
      // SPEC C: a piece of the root's real Following is the root's — a persona's pane never lists it (on the live site;
      // elsewhere there are none)
      bin: (await binEntries()).filter((b) => !(HUB_PIECE_RE.test(b.chunkId) && hubActing)),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

/** SPEC C: a persona is the tab's acting identity on the live device (unknown = acting: fail closed) */
async function personaActsHere(): Promise<boolean> {
  try {
    return await (await import("@/lib/fc/hubRead/separation")).personaActing();
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "knobs") {
      const active = await retryAdapter(() => adapters.mode.getActive(personaId));
      const modeId = typeof body.modeId === "string" && body.modeId ? body.modeId : active.id;
      const knobs = await setKnobs(modeId, {
        perBuild: body.perBuild === undefined ? undefined : Number(body.perBuild),
        chunkWords: body.chunkWords === undefined ? undefined : Number(body.chunkWords),
      });
      let rechunked = 0;
      if (body.rechunk === true) {
        // RE-CUTTING IS EXPLICIT, and its cost is stated rather than hidden: the
        // chunk boundaries move, so chunk-level read marks no longer name
        // anything. The response says how many pieces were re-cut; the marks are
        // left in place because a stale id matches nothing and a future re-cut
        // back to the old width would find them again.
        const schedules = await retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId));
        for (const s of schedules) {
          const out = await retryAdapter(() => adapters.feedHealth.rechunkReadwise(s.postHash, personaId, knobs.chunkWords));
          if (out) rechunked++;
        }
      }
      return NextResponse.json({ ok: true, modeId, knobs, rechunked });
    }

    if (body.action === "priorityFolder") {
      const folderId = String(body.folderId ?? "");
      if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
      const folders = await retryAdapter(() => adapters.space.listFolders(personaId));
      if (!folders.some((f) => f.id === folderId))
        return NextResponse.json({ error: "not one of your folders", code: "not_own" }, { status: 403 });
      return NextResponse.json({ ok: true, priorityFolders: await setPriorityFolder(folderId, body.on === true) });
    }

    if (body.action === "dwell") {
      const chunkId = String(body.chunkId ?? "");
      const found = await chunkTextOf(personaId, chunkId);
      if (!found) return NextResponse.json({ error: "unknown chunk", code: "unknown_chunk" }, { status: 404 });
      const r = await recordDwell(chunkId, Number(body.ms ?? 0), found.text);
      return NextResponse.json({ ok: true, ...r, words: found.text.trim().split(/\s+/).filter(Boolean).length });
    }

    if (body.action === "bury") {
      const chunkId = String(body.chunkId ?? "");
      const found = await chunkTextOf(personaId, chunkId);
      if (!found) return NextResponse.json({ error: "unknown chunk", code: "unknown_chunk" }, { status: 404 });
      return NextResponse.json({ ok: true, buried: await bury(chunkId, found.postHash, found.index, found.text) });
    }

    if (body.action === "restore") {
      const chunkId = String(body.chunkId ?? "");
      // SPEC C: restoring a piece of the root's real Following is the root's act — never from a persona's tab
      if (HUB_PIECE_RE.test(chunkId) && (await personaActsHere()))
        return NextResponse.json({ error: "You're acting as a persona, so your own Farcaster Following's reading pieces stay put until you're yourself again.", code: "acting_persona" }, { status: 409 });
      const did = await restore(chunkId);
      if (!did) return NextResponse.json({ error: "not in the bin", code: "not_buried" }, { status: 404 });
      return NextResponse.json({ ok: true, restored: chunkId });
    }

    if (body.action === "threshold") {
      // read-only helper for the UI: what this chunk would need
      const found = await chunkTextOf(personaId, String(body.chunkId ?? ""));
      if (!found) return NextResponse.json({ error: "unknown chunk" }, { status: 404 });
      return NextResponse.json({ chunkId: chunkIdOf(found.postHash, found.index), thresholdMs: dwellThresholdMs(found.text) });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HubPieceRefused) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
