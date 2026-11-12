import { NextResponse } from "next/server";
// THE ACT-AS PICKER'S OPTION LIST — SEEDED personas only (SEED_VIEWER.personas,
// the same allowlist /api/actions/act-as validates against). Deliberately NOT
// useApp()'s persona context, which is the phase-1 fixture/validator-backed
// identity track — a different system entirely. Reusing it here would be
// the two-identity-universes trap this project keeps re-finding: the picker
// would offer identities the act-as route's own authorization check doesn't
// recognize, or worse, silently authorize the wrong ones.
import { SEED_VIEWER, personaById } from "@/lib/adapters/mock/store";
import { listPersonas } from "@/lib/identity/keystore";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { audienceOf } from "@/lib/private/visibility";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { boundDestinationsFor } from "@/lib/crosspost/destinations";

export const dynamic = "force-dynamic";

export async function GET() {
  const activeId = activeSeedPersonaId();
  // MULTI-FID Gate 2: a persona minted on this device (a fork, a new account) is an actor too
  const minted = listPersonas().map((p) => p.id).filter((id) => !SEED_VIEWER.personas.includes(id) && personaById.has(id));
  // POST-DEPLOY Gate 2: acting AS another persona is the loudest cross-persona
  // surface there is — under compartment mode the picker offers the active
  // persona only, so a shared screen cannot even enumerate the siblings.
  const { viewScope } = await import("@/lib/identity/chrome");
  const scope = await viewScope(activeId, [...SEED_VIEWER.personas, ...minted]);
  const visible = new Set(scope.visiblePersonaIds);
  const options = [...SEED_VIEWER.personas, ...minted]
    .filter((id) => visible.has(id))
    .map((id) => {
      const p = personaById.get(id);
      if (!p) return null;
      const isPrivate = isPrivatePersona(id);
      return {
        id,
        handle: p.handle,
        name: p.name,
        avatarUrl: p.avatarUrl,
        kind: isPrivate ? ("private" as const) : ("public" as const),
        audienceCount: isPrivate ? audienceOf(id).length : null,
        destinationIds: boundDestinationsFor(id).map((d) => d.id),
      };
    })
    .filter(Boolean);
  return NextResponse.json({ options, activeId, scope: { compartment: scope.compartment, reason: scope.reason } });
}
