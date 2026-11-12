import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaByHandle } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

const idOf = (v: string | undefined | null): string | null => {
  if (!v) return null;
  const byHandle = personaByHandle.get(v);
  if (byHandle) return byHandle.id;
  // Already an id? Accept it. Otherwise this is an unknown handle, and
  // passing it through would create a phantom viewer that silently resolves
  // nothing — a bad input masquerading as a broken feature.
  if (v.startsWith("persona_") || v.startsWith("p_")) return v;
  return null;
};

export async function GET(req: NextRequest) {
  const personaId = idOf(req.nextUrl.searchParams.get("personaId")) ?? activeSeedPersonaId();
  try {
    const [grants, asked] = await Promise.all([
      retryAdapter(() => adapters.identity.listGrantsFor(personaId)),
      retryAdapter(() => adapters.identity.whoAsked(personaId)),
    ]);
    return NextResponse.json({ grants, whoAsked: asked });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    if (body.action === "revoke") {
      // Revoke is a tombstone. The UI says so plainly: they stop seeing the
      // link, they cannot unlearn it.
      const grant = await retryAdapter(() => adapters.identity.revokeGrant(body.grantId));
      return NextResponse.json({ grant });
    }

    if (body.action === "request") {
      // Opt-in resolution. The asking is recorded and shown to the owner.
      const from = idOf(body.fromPersona);
      const to = idOf(body.toPersona);
      const requester = idOf(body.requesterPersona) ?? activeSeedPersonaId();
      if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });
      const request = await retryAdapter(() =>
        adapters.identity.requestResolution(from, to, requester)
      );
      return NextResponse.json({ request });
    }

    const from = idOf(body.fromPersona);
    const to = idOf(body.toPersona);
    if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });
    const grant = await retryAdapter(() =>
      adapters.identity.issueGrant({
        fromPersona: from,
        toPersona: to,
        audienceMember: idOf(body.audienceMember) ?? undefined,
        tier: body.tier,
      })
    );
    return NextResponse.json({ grant });
  } catch (e) {
    const err = e as AdapterError;
    return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 503 });
  }
}
