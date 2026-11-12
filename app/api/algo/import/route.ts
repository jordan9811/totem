import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { importArtifact } from "@/lib/algo/service";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { artifact, activate } = await req.json();
  try {
    const result = await importArtifact(artifact, activeSeedPersonaId(), activate !== false);
    // Success is a mode (algo) OR a pack (filter_pack) — a pack import
    // deliberately returns mode:null, which is not a refusal.
    if (!result.mode && !result.pack && !result.lens) {
      // Refused. The violations say exactly why — a hostile artifact is
      // named, not silently declawed.
      return NextResponse.json({ error: "artifact refused", violations: result.violations }, { status: 422 });
    }
    return NextResponse.json({ mode: result.mode, pack: result.pack, lens: result.lens, violations: result.violations });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
