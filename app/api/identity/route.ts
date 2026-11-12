import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { resolveIdentity } from "@/lib/identity/resolver";
import { personaByHandle } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

/**
 * Identity resolution for a persona, from a given viewer's perspective.
 * This is the endpoint the acceptance tests drive to prove both the positive
 * (granted viewer sees merged) and negative (non-granted sees bare) case.
 */
export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  const personaParam = req.nextUrl.searchParams.get("personaId");
  const viewerParam = req.nextUrl.searchParams.get("viewerPersonaId");

  const personaId = personaParam ?? (handle ? personaByHandle.get(handle)?.id : null);
  if (!personaId) return NextResponse.json({ error: "unknown persona" }, { status: 404 });

  // An explicit `viewerPersonaId=` (empty) means "anonymous viewer".
  const viewer =
    viewerParam === null ? activeSeedPersonaId() : viewerParam === "" ? null : viewerParam;

  try {
    const identity = resolveIdentity(personaId, viewer);
    const grants = await retryAdapter(() => adapters.identity.listGrantsFor(personaId));
    return NextResponse.json({
      identity,
      // Grant metadata for the management screen. Note this lists grants
      // ABOUT this persona, which its owner may see; it is not a disclosure
      // channel because the resolver above already gates rendering.
      grantCount: grants.filter((g) => g.revokedAt === null).length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
