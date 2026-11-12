import { NextRequest, NextResponse } from "next/server";
// FC Gate 4 — the attribution read surface. Viewer-scoped: the disclosure
// gate runs against the ACTIVE persona (View-As respected, same as every
// other viewer-scoped surface), so a non-granted viewer context gets null
// for a private-tier persona's cast — bare FID, even in our client.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { attributionsFor } from "@/lib/fc/attribution";
import { hydrate } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await hydrate(); // direct state() reader — must not serve pre-hydration emptiness as "no attribution"
  const hashes = (req.nextUrl.searchParams.get("hashes") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 100);
  const viewer = activeSeedPersonaId();
  return NextResponse.json({ attributions: attributionsFor(hashes, viewer) });
}
