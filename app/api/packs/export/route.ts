import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaById } from "@/lib/adapters/mock/store";
import { exportPack } from "@/lib/packs/service";
import { sanitizeArtifact } from "@/lib/algo/artifact";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import type { Rule } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

/** The builder's export: compose existing rules (by id), predicates and
 * curator riders into a signed pack artifact. The composition is run back
 * through the SAME sanitizer imports use before it is returned — a builder
 * that could produce an artifact the importer would refuse is a builder
 * lying about what it built. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const actor = activeSeedPersonaId();
  const author = personaById.get(actor);
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const rules: Pick<Rule, "name" | "action" | "root">[] = [];
  for (const id of body.ruleIds ?? []) {
    const r = await retryAdapter(() => adapters.rules.get(id));
    if (r) rules.push({ name: r.name, action: r.action, root: r.root });
  }

  // MEGA PASS 2 Gate 2: `lensId` pins a stored lens's spec into the pack
  let lens: import("@/lib/lens/types").LensSpec | undefined;
  if (body.lensId) {
    const { getLens } = await import("@/lib/lens/service");
    const stored = getLens(String(body.lensId));
    if (!stored) return NextResponse.json({ error: "unknown lens" }, { status: 404 });
    lens = { signals: { ...stored.spec.signals }, influenceDistribution: JSON.parse(JSON.stringify(stored.spec.influenceDistribution)) };
  }
  const artifact = exportPack({
    name: String(body.name),
    summary: String(body.summary ?? ""),
    authorPersonaId: actor,
    authorHandle: author?.handle ?? "unknown",
    rules,
    attestationPredicates: body.attestationPredicates ?? [],
    curatorSubscriptions: body.curatorSubscriptions ?? [],
    ...(lens ? { lens } : {}),
  });

  const { artifact: sanitized, violations } = sanitizeArtifact(artifact);
  if (!sanitized)
    return NextResponse.json({ error: "composition refused", violations }, { status: 422 });
  return NextResponse.json({ artifact, violations });
}
