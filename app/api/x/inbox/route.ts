import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 5 — the @totem inbox hook.
// GET                          mode (fixture/live), the cursor, the session's replies log (hashed senders), the
//                              active persona's linked handle and "From X DM" folder + DM-sourced schedules
// POST {action:"poll"}         ONE on-demand read of the inbox through the spend ledger; lands linked senders' links
// POST {action:"setCadence", modeId, every, appearance}   per-mode frequency/appearance for DM-sourced readwise
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { state } from "@/lib/adapters/mock/store";
import { DEFAULT_DM_READWISE, DM_FOLDER_NAME, INBOX_CURSOR_KEY, inboxMode, inboxReplies, ingestInbox, linkedHandleFor } from "@/lib/x/inbox";
import { SpendCapError } from "@/lib/x/spend";

export const dynamic = "force-dynamic";

export async function GET() {
  const personaId = activeSeedPersonaId();
  try {
    const folders = await retryAdapter(() => adapters.space.listFolders(personaId));
    const folder = folders.find((f) => f.ownerPersonaId === personaId && f.name === DM_FOLDER_NAME) ?? null;
    const schedules = (await retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId))).filter((r) => r.postHash.startsWith("dm:"));
    const modes = await retryAdapter(() => adapters.mode.list(personaId));
    return NextResponse.json({
      mode: inboxMode(),
      cursor: state().xSyncCursor.get(INBOX_CURSOR_KEY) ?? 0,
      linkedHandle: linkedHandleFor(personaId),
      replies: inboxReplies(),
      folder: folder ? { id: folder.id, name: folder.name, count: folder.postHashes.length, isPublic: folder.isPublic } : null,
      schedules: schedules.map((r) => ({ postHash: r.postHash, chunks: r.chunks.length, next: r.nextChunkIndex })),
      cadence: modes.map((m) => ({ modeId: m.id, name: m.name, ...(m.dmReadwise ?? DEFAULT_DM_READWISE) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const personaId = activeSeedPersonaId();
  try {
    if (body.action === "poll") {
      const r = await ingestInbox();
      return NextResponse.json(r);
    }
    if (body.action === "setCadence") {
      const modeId = String(body.modeId ?? "");
      const mode = await retryAdapter(() => adapters.mode.get(modeId));
      if (!mode || mode.personaId !== personaId) return NextResponse.json({ error: "mode does not belong to the active persona" }, { status: 403 });
      const every = Number(body.every);
      const appearance = body.appearance === "full" ? "full" : "chunk";
      if (!Number.isInteger(every) || every < 1 || every > 20) return NextResponse.json({ error: "every must be an integer 1..20" }, { status: 400 });
      const updated = await retryAdapter(() => adapters.mode.update(modeId, { dmReadwise: { every, appearance } }));
      return NextResponse.json({ mode: updated });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof SpendCapError) return NextResponse.json({ error: e.message, code: "spend_cap" }, { status: 402 });
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
