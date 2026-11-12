import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const connectors = await retryAdapter(() => adapters.graph.listConnectors());
    return NextResponse.json({ connectors });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const { connectorId, jobId, action } = await req.json();
  try {
    // Backpack pass: commit is a SEPARATE, explicit action — a previewed
    // import writes nothing until the user confirms.
    if (action === "commit") {
      if (!jobId) return NextResponse.json({ error: "jobId required to commit" }, { status: 400 });
      const job = await retryAdapter(() => adapters.graph.commitImport(jobId));
      return NextResponse.json({ job });
    }
    if (jobId) {
      const job = await retryAdapter(() => adapters.graph.advanceImport(jobId));
      return NextResponse.json({ job });
    }
    if (!connectorId) return NextResponse.json({ error: "connectorId required" }, { status: 400 });
    const job = await retryAdapter(() =>
      adapters.graph.startImport(activeSeedPersonaId(), connectorId)
    );
    return NextResponse.json({ job });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 409 : 503 });
  }
}
