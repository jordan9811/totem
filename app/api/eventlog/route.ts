import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

/**
 * The viewer's OWN relationship log. The actor comes from the server session
 * — there is deliberately no way to name someone else's log, and this route's
 * family is the only place that may return event-log material at all (the
 * leak sweep enforces that everywhere else).
 *
 * PROD-LIVE (D-CU-0-4): the family is two routes now — this one and
 * /api/eventlog/history (the profile's relationship-history tab, read from
 * the same log with the same session-fixed actor). Every other route,
 * including the page-view routes the browser device answers (/api/profile,
 * /api/thread, /api/notifications, …), is scanned for log ids and schema
 * fields by scripts/accept-a1.mjs check 9 and scripts/root-leak.mjs.
 */
export async function GET(req: NextRequest) {
  const actor = activeSeedPersonaId();
  const target = req.nextUrl.searchParams.get("target");
  try {
    const events = target
      ? await retryAdapter(() => adapters.eventLog.forTarget(actor, target))
      : await retryAdapter(() => adapters.eventLog.list(actor));
    return NextResponse.json({ actor, events });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
