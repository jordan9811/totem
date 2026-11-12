import "server-only";
// PROBABLY-SEEN COLLAPSE. A crossposted item exists on two networks; a
// viewer who overlaps the author's audience there has probably seen it, so
// it renders ONCE with an "also posted to X" chip. A viewer with no overlap
// gets both copies — the local cast and the mirror — because for them the
// two really are distinct encounters. Semantics are "probably seen", the
// viewer can turn collapse off, and nothing here is ever more than a
// rendering decision: the underlying records are identical for everyone.
import type { Cast } from "@/lib/types";
import { state } from "@/lib/adapters/mock/store";
import { DESTINATIONS, viewerOverlaps } from "./destinations";

export function collapseDisabledFor(viewer: string): boolean {
  return state().collapseDisabled.has(viewer);
}

export async function setCollapseDisabled(viewer: string, disabled: boolean): Promise<void> {
  const s = state();
  if (disabled) s.collapseDisabled.add(viewer);
  else s.collapseDisabled.delete(viewer);
  const { persistNs } = await import("@/lib/adapters/mock/store");
  await persistNs("collapsePrefs");
}

/** Decorate a cast list with crosspost chips and, where the viewer does NOT
 * overlap (or has collapse off), the mirror copies. */
export function decorateCrossposts(casts: Cast[], viewer: string): Cast[] {
  const s = state();
  const out: Cast[] = [];
  for (const cast of casts) {
    const records = s.crossposts.get(cast.hash);
    if (!records?.length) {
      out.push(cast);
      continue;
    }
    const names = records.map((r) => DESTINATIONS[r.destinationId]?.displayName ?? r.destinationId);
    out.push({ ...cast, alsoPostedTo: names });
    for (const r of records) {
      const overlaps = viewerOverlaps(r.destinationId, viewer, cast.personaId);
      const collapse = overlaps && !collapseDisabledFor(viewer);
      if (!collapse) {
        // the mirror: the copy as it exists on the other network
        out.push({
          ...cast,
          hash: cast.hash + "#mirror:" + r.destinationId,
          alsoPostedTo: undefined,
          mirrorOf: cast.hash,
          text: cast.text,
        });
      }
    }
  }
  return out;
}
