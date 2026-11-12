import "server-only";
// SPEC C — the device's own records the extras on the real Following are drawn from (lib/fc/hubRead/extras.ts shapes
// them; lib/fc/hubRead/read.ts asks for them on every timeline answer, after the mode).
//
// KEYED EXACTLY AS THE ROUTES KEY THEM: the readwise state is root-scoped by construction (one sealed record, keyed by
// chunk, lib/readwise/state.ts); the desks and the folders are the acting identity's, activeSeedPersonaId(), which the
// hub timeline only answers for while no persona acts (read.ts admit), so it names the public self: the root's own
// subscriptions, the same ones /api/curators and /api/readwise read and write.
//
// NOTHING NEW LEAVES THE DEVICE, AND NOTHING IS READ FROM FARCASTER'S NODE. The readwise state is the sealed
// `readwiseState` record (read once per tab by the same signed GET the sample feed makes, cached after); the desks are the
// device's own store; what a ring sent is memory only (lib/rings/received.ts: the drop the tick reads for every device,
// whether or not anything was sent to it). No write, ever: reading the page never marks a piece read or skipped (the card
// does that, sealed, when it leaves the screen).
//
// NEVER FAIL OPEN, part by part: an unreadable readwise state is UNAVAILABLE (no marks, no requeue: never "nothing read,
// nothing in the bin", which would hand back what you dismissed); an unreadable desk list shows no notes and says so;
// unreadable folders weigh nothing and say so. None of them hides or empties the Following itself.
import { parseHubCastTarget } from "./copy";
import type { HubExtrasSpec } from "./extras";

export async function hubExtrasSpec(modeId: string | null): Promise<HubExtrasSpec> {
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  let viewer = "";
  try {
    viewer = activeSeedPersonaId();
  } catch {
    viewer = "";
  }
  return { readwise: await readwisePart(viewer, modeId), notes: await notesPart(viewer), sends: await sendsPart() };
}

async function readwisePart(viewer: string, modeId: string | null): Promise<HubExtrasSpec["readwise"]> {
  const rw = await import("@/lib/readwise/state");
  let dwell: Record<string, { read: boolean }>;
  let buried: Set<string>;
  let prioIds: string[];
  let perBuild: number;
  try {
    dwell = await rw.dwellMap();
    buried = await rw.buriedIds();
    prioIds = await rw.priorityFolders();
    perBuild = (modeId ? await rw.knobsFor(modeId) : { ...rw.DEFAULTS }).perBuild;
  } catch {
    return { state: "unavailable" };
  }
  // the folder weight: the posts in the folders you marked priority (a plain weight, exactly as on sample pieces)
  const priority = new Set<string>();
  let foldersUnreadable = false;
  if (prioIds.length) {
    try {
      const { adapters } = await import("@/lib/adapters/registry");
      const { retryAdapter } = await import("@/lib/adapters/retry");
      const prio = new Set(prioIds);
      for (const f of await retryAdapter(() => adapters.space.listFolders(viewer))) if (prio.has(f.id)) for (const h of f.postHashes) priority.add(h);
    } catch {
      foldersUnreadable = true;
      priority.clear();
    }
  }
  return { state: "ok", dwell, buried, priority, perBuild, foldersUnreadable };
}

async function notesPart(viewer: string): Promise<HubExtrasSpec["notes"]> {
  try {
    const { subscribedAnnotations } = await import("@/lib/curators/annotations");
    const list: Extract<HubExtrasSpec["notes"], { state: "ok" }>["list"][number][] = [];
    for (const { annotation, feed, action } of subscribedAnnotations(viewer)) {
      const t = parseHubCastTarget(annotation.targetCastId);
      if (!t) continue; // a note on a Totem post: the sample feed's surface, not this one
      list.push({ fid: t.fid, hash: t.hash, desk: feed.name, claim: annotation.claim, evidenceLink: annotation.evidenceLink, action, flagsAuthor: annotation.flagsAuthor === true });
    }
    return { state: "ok", list };
  } catch {
    return { state: "unreadable" };
  }
}

async function sendsPart(): Promise<HubExtrasSpec["sends"]> {
  try {
    return (await import("@/lib/rings/received")).receivedSends();
  } catch {
    return [];
  }
}
