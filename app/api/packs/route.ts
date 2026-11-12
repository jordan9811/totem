import { NextRequest, NextResponse } from "next/server";
import { getPack, listPacks, packPasses } from "@/lib/packs/service";
import { personaByHandle, personaById } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

/**
 * THE PACK READ API — the surface downstream ecosystem apps consume.
 *
 *   GET /api/packs                      → imported packs
 *   GET /api/packs?packId=X&personaId=Y → { pass: boolean }
 *
 * The check answers pass or fail and NOTHING else. No reason, no matched
 * predicate, no distinguishing "lacks a claim" from "flagged by a desk" —
 * disclosure wins, and a reason field would turn every pack into an oracle
 * over private graph facts and hidden linkages.
 */
export async function GET(req: NextRequest) {
  const packId = req.nextUrl.searchParams.get("packId");
  const personaParam = req.nextUrl.searchParams.get("personaId");
  if (!packId) {
    return NextResponse.json({
      packs: listPacks().map((p) => ({
        id: p.id,
        name: p.artifact.name,
        authorHandle: p.artifact.authorHandle,
        algoVersion: p.artifact.algoVersion,
      })),
    });
  }
  const pack = getPack(packId);
  if (!pack) return NextResponse.json({ error: "unknown pack" }, { status: 404 });
  if (!personaParam) return NextResponse.json({ error: "personaId required" }, { status: 400 });
  const persona = personaByHandle.get(personaParam)?.id ?? (personaById.has(personaParam) ? personaParam : null);
  if (!persona) return NextResponse.json({ error: "unknown persona" }, { status: 404 });
  return NextResponse.json({ packId, personaId: persona, pass: packPasses(pack.artifact, persona) });
}
