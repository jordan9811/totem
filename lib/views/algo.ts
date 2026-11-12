import "server-only";
// PROD-LIVE (D-CU-0-4): the builder behind /algo/[cardId] — THE MANDATORY PREVIEW.
//
// The preview runs the candidate through the identical feed build activation will use, for THIS viewer — so on a
// public deployment it can only be computed where the viewer's identity lives: the browser device, answering
// GET /api/algo/view. On the rig the server page calls this same function and hands the result to the island as its
// initial data. The page's old inline computation, moved verbatim.
import { personaById } from "@/lib/adapters/mock/store";
import { getAlgoCard, previewArtifact } from "@/lib/algo/service";
import type { AlgoDetailView } from "./types";

/** null = no such card. THROWS when the preview cannot be computed (the rig page has always let that surface). */
export async function algoDetailView(cardId: string, viewer: string): Promise<AlgoDetailView | null> {
  const card = getAlgoCard(cardId);
  if (!card) return null;
  const { influence: _notRenderedHere, ...preview } = await previewArtifact(card.artifact, viewer);
  void _notRenderedHere;
  const author = personaById.get(card.artifact.authorPersonaId);
  return {
    cardId: card.id,
    artifact: card.artifact,
    authorName: author?.name ?? card.artifact.authorHandle,
    preview,
  };
}
