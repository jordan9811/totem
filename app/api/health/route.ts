import { NextRequest, NextResponse } from "next/server";
import { healthPayload } from "@/lib/health";
import { appPort } from "@/lib/ports";

export const dynamic = "force-dynamic";

/** Attestation pass Gate 0: the signed Totem health payload — the ONLY
 * thing the sweep runner's liveness probe accepts (lib/health.ts). */
export async function GET(req: NextRequest) {
  let port = appPort();
  try {
    const p = Number(new URL(req.url).port);
    if (Number.isInteger(p) && p > 0) port = p;
  } catch {
    /* the pinned port */
  }
  return NextResponse.json(healthPayload(port), { headers: { "Cache-Control": "no-store" } });
}
