import "server-only";
// Marketplace-lite seed: one curator, two published algorithms, one public
// folder holding both. Direct store writes, same stance as every other
// seeding module — this is fixture staging, not user action.
import { SEED_PERSONAS, state, personaById } from "@/lib/adapters/mock/store";
import { signArtifact, type AlgoArtifact } from "./artifact";
import type { AlgoCard } from "./service";
import { createHash } from "@/lib/platform/crypto";

export const CURATOR_HANDLE = "quietvalidator";
export const ALGO_FOLDER_ID = "folder_algoshelf";

function build(a: Omit<AlgoArtifact, "signature">): AlgoArtifact {
  // Seeded authors sign via fixture keys; null here means key wiring is
  // broken — throw loudly rather than seed an unverifiable world.
  const signature = signArtifact(a);
  if (signature === null)
    throw new Error(`seedAlgoMarketplace: no signing key for seeded persona ${a.authorHandle} (${a.authorPersonaId})`);
  return { ...a, signature };
}

export function seedAlgoMarketplace(): number {
  const curator = SEED_PERSONAS.find((p) => p.handle === CURATOR_HANDLE);
  if (!curator) return 0;
  const s = state();
  if (s.algoCards.size > 0 && s.folders.has(ALGO_FOLDER_ID)) return 0;

  // curator must render everywhere — and must be registered BEFORE signing,
  // because the fixture-key scope guard is personaById membership.
  if (!personaById.has(curator.id)) personaById.set(curator.id, curator);

  const artifacts: AlgoArtifact[] = [
    build({
      schemaVersion: 1,
      name: "Calm Signal",
      summary: "High-trust authors only, ranked calm. No breaking-news churn.",
      authorPersonaId: curator.id,
      authorHandle: curator.handle,
      algoVersion: 3,
      ranking: { recency: 0.15, engagement: 0.1, authorAffinity: 0.45, clusterAffinity: 0.3 },
      rules: [
        {
          name: "high-trust authors",
          action: "hide",
          root: { combinator: "AND", clauses: [{ field: "author.tier", op: "lt", value: 4 }] },
        },
      ],
      modeFlags: { calmRanking: true, showTrending: false },
      createdAt: 1_770_000_000_000,
    }),
    build({
      schemaVersion: 1,
      name: "Longform Only",
      summary: "Drops update-churn entirely; longform and analysis surface first.",
      authorPersonaId: curator.id,
      authorHandle: curator.handle,
      algoVersion: 1,
      ranking: { recency: 0.1, engagement: 0.2, authorAffinity: 0.3, clusterAffinity: 0.4 },
      rules: [
        {
          name: "no update churn",
          action: "hide",
          root: { combinator: "AND", clauses: [{ field: "post.isUpdate", op: "eq", value: true }] },
        },
      ],
      modeFlags: { longformOnly: true, calmRanking: true },
      createdAt: 1_770_000_100_000,
    }),
    build({
      schemaVersion: 1,
      name: "King of the Hill",
      summary: "Standing claims first: the unrefuted last word, weighted by author tier — never reply volume.",
      authorPersonaId: curator.id,
      authorHandle: curator.handle,
      algoVersion: 1,
      // engagement weight ZERO is the point: volume is not weight.
      ranking: { recency: 0.3, engagement: 0, authorAffinity: 0.35, clusterAffinity: 0.35 },
      rules: [],
      modeFlags: { kingOfTheHill: true, calmRanking: true, showTrending: false },
      createdAt: 1_770_000_200_000,
    }),
  ];

  const ids: string[] = [];
  for (const artifact of artifacts) {
    const card: AlgoCard = {
      id: "0xalgo" + createHash("sha256").update(artifact.signature).digest("hex").slice(0, 12),
      artifact,
      publishedByPersonaId: curator.id,
      publishedAt: artifact.createdAt,
    };
    s.algoCards.set(card.id, card);
    ids.push(card.id);
  }

  // The shelf: a public folder holding algo cards through the SAME
  // postHashes slot ordinary folders use — marketplace-lite is folder infra,
  // not a parallel system.
  if (!s.folders.has(ALGO_FOLDER_ID)) {
    s.folders.set(ALGO_FOLDER_ID, {
      id: ALGO_FOLDER_ID,
      name: "The Algo Shelf",
      ownerPersonaId: curator.id,
      isPublic: true,
      postHashes: ids,
      createdAt: 1_770_000_000_000,
    });
  }

  return ids.length;
}
