import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 6 — relationship porting on X.
// GET                                   this device's ports (issued and pending), the constants, the gates' state
// POST {fromPersona, toPersona, counterpart: {personaId?|handle?}, targetPostId}   issue (or queue) a port
// POST {action: "confirm"|"decline", portId}   the ISSUER's answer to an offer someone raised by proving the handle
// Refusals are typed (AltLinkRefusal): not_own / not_linked / no_alt_handle / disclaimer_required / rate_limited.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { ALT_LINK_DAILY_CAP, ALT_LINK_MAX_DELAY_MS, ALT_LINK_MIN_DELAY_MS, AltLinkRefusal, dailyRemaining, hasAckedDisclaimer } from "@/lib/x/altlink";
import { confirmPort, listPorts, portStatus, runRelationshipPort } from "@/lib/x/porting";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = activeSeedPersonaId();
  try {
    const ports = await listPorts();
    // GATE 5 (attack-post-1 F-3): a port names two of this root's personas and the X handles
    // behind them — alt-link material of the most sensitive kind, and the single most
    // revealing table a shared screen could show. Under compartment mode only the ports the
    // ACTIVE persona is a party to are listed.
    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
    const visible = new Set(await visibleOwnPersonaIds());
    const scoped = ports.filter((p) => visible.has(p.fromPersona) || visible.has(p.toPersona));
    // GATE 5 (attack-post-1 F-3b): narrowing the row SET was not enough — each surviving row
    // names BOTH personas and BOTH X handles by construction, so a port the active persona is
    // one end of still handed back the sibling at the other end and the root's two handles as
    // a pair. That is the linkage compartment mode exists to keep off a shared screen. Under
    // compartment mode the hidden end and the handle that belongs to it are redacted; the row
    // keeps its id and state so the owner can still see that something is pending.
    const compartment = (await (await import("@/lib/identity/chrome")).visibleOwnPersonaIds()).length === 1;
    const redact = (p: (typeof scoped)[number]) => {
      if (!compartment) return { ...p, state: portStatus(p) };
      const fromVisible = visible.has(p.fromPersona);
      return {
        ...p,
        state: portStatus(p),
        fromPersona: fromVisible ? p.fromPersona : null,
        toPersona: fromVisible ? null : p.toPersona,
        handles: undefined,
        redacted: true,
      };
    };
    return NextResponse.json({
      ports: scoped.map(redact),
      constants: { dailyCap: ALT_LINK_DAILY_CAP, minDelayMs: ALT_LINK_MIN_DELAY_MS, maxDelayMs: ALT_LINK_MAX_DELAY_MS },
      disclaimerAcked: hasAckedDisclaimer(viewer),
      dailyRemaining: dailyRemaining(viewer),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    // POST-DEPLOY Gate 0: the issuer's answer to an offer raised by someone proving the handle. Until this runs,
    // a matched port has disclosed nothing.
    if (body.action === "confirm" || body.action === "decline") {
      const port = await confirmPort(String(body.portId ?? ""), body.action === "confirm");
      return NextResponse.json({ port: { ...port, state: portStatus(port) } });
    }
    const counterpart = (body.counterpart ?? {}) as { personaId?: unknown; handle?: unknown };
    const { port, grant } = await runRelationshipPort({
      fromPersona: String(body.fromPersona ?? activeSeedPersonaId()),
      toPersona: String(body.toPersona ?? ""),
      counterpart: { personaId: typeof counterpart.personaId === "string" ? counterpart.personaId : undefined, handle: typeof counterpart.handle === "string" ? counterpart.handle : undefined },
      targetPostId: String(body.targetPostId ?? ""),
    });
    return NextResponse.json({ port: { ...port, state: portStatus(port) }, grant });
  } catch (e) {
    if (e instanceof AltLinkRefusal) {
      const status = e.reason === "rate_limited" ? 429 : e.reason === "disclaimer_required" ? 428 : e.reason === "not_own" ? 403 : 400;
      return NextResponse.json({ error: e.message, code: e.reason }, { status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
