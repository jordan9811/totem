import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { audienceOf } from "@/lib/private/visibility";
import { grantKind, signGrantWith, resignGrant, OPEN_AUDIENCE, type Grant } from "@/lib/identity/grants";
import { signForPersona } from "@/lib/identity/keys";
import { personaById, persistNs, state } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

/** Who can see this private persona's posts. */
export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId") ?? activeSeedPersonaId();
  const members = audienceOf(personaId).map((m) => ({
    personaId: m,
    handle: personaById.get(m)?.handle ?? m,
    name: personaById.get(m)?.name ?? m,
    avatarUrl: personaById.get(m)?.avatarUrl ?? null,
  }));
  return NextResponse.json({ personaId, members });
}

/**
 * Add or remove one audience member.
 *
 * Revoke is a tombstone, not a delete: the row stays with revokedAt set, so
 * the history of who was once trusted is not quietly rewritten. What changes
 * is that isLive() stops returning it, which is what every read consults.
 */
export async function POST(req: NextRequest) {
  const { personaId, audienceMember, action } = await req.json();
  if (!personaId || !audienceMember)
    return NextResponse.json({ error: "personaId and audienceMember required" }, { status: 400 });
  if (audienceMember === OPEN_AUDIENCE)
    return NextResponse.json(
      { error: "an audience grant cannot name the open audience — that is a public post" },
      { status: 400 }
    );

  const s = state();
  if (action === "revoke") {
    let n = 0;
    for (const g of s.grantsV3.values()) {
      if (
        grantKind(g) === "audience" &&
        g.fromPersona === personaId &&
        g.audienceMember === audienceMember &&
        g.revokedAt === null
      ) {
        // Revocation is a re-signed claim, not a field flip: same id,
        // fresh signature over the revoked canonical. Can't sign → refuse.
        const revoked = resignGrant(
          { ...g, revokedAt: Date.now() },
          (c) => signForPersona(g.fromPersona, c)
        );
        if (revoked === null)
          return NextResponse.json({ error: "cannot sign as this persona" }, { status: 403 });
        s.grantsV3.set(g.id, revoked);
        n++;
      }
    }
    await persistNs("grantsV3");
    return NextResponse.json({ revoked: n, members: audienceOf(personaId) });
  }

  const base: Omit<Grant, "id" | "signature"> = {
    fromPersona: personaId,
    toPersona: personaId,
    audienceMember,
    tier: "whitelist",
    kind: "audience",
    issuedAt: Date.now(),
    revokedAt: null,
  };
  // The issuer IS fromPersona. No resolvable key → refuse, never store unsigned.
  const signed = signGrantWith(base, (c) => signForPersona(base.fromPersona, c));
  if (signed === null)
    return NextResponse.json({ error: "cannot sign as this persona" }, { status: 403 });
  s.grantsV3.set(signed.id, { ...base, id: signed.id, signature: signed.signature });
  await persistNs("grantsV3");
  return NextResponse.json({ granted: signed.id, members: audienceOf(personaId) });
}
