import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { previewArtifact } from "@/lib/algo/service";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

/** The MANDATORY pre-activation preview: exact counts, not estimates. */
export async function POST(req: NextRequest) {
  const { artifact } = await req.json();
  try {
    const preview = await previewArtifact(artifact, activeSeedPersonaId());
    return NextResponse.json({ preview });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
