import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { algoDetailView } from "@/lib/views/algo";
import type { AlgoDetailView } from "@/lib/views/types";
import { AlgoPreviewBody } from "@/components/spaces/AlgoPreviewBody";

export const metadata: Metadata = { title: "Algorithm preview / X" };
export const dynamic = "force-dynamic";

/**
 * THE MANDATORY PREVIEW. This page is the only path to activation, and the
 * numbers on it are not estimates — the preview runs the candidate through
 * the identical feed build activation will use, against the deterministic
 * seeded corpus, and diffs. What it says is what you get.
 *
 * PROD-LIVE (D-CU-0-4): the preview is a feed build for THE VIEWER, and on a public deployment the server has no
 * viewer (it used to 404 every card there, because its lookup and buildFeed both need identity). It passes the param
 * on; AlgoPreviewBody asks the browser device, which runs the same builder for the visitor. On the rig: the same
 * computation here, as always — an unknown card 404s, a preview that throws surfaces.
 */
export default async function AlgoPreviewPage({ params }: { params: { cardId: string } }) {
  let initial: AlgoDetailView | null = null;
  if (!isPublicDeployment()) {
    initial = await algoDetailView(params.cardId, activeSeedPersonaId());
    if (!initial) notFound();
  }

  return <AlgoPreviewBody cardId={params.cardId} initial={initial} />;
}
