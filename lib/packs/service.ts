import "server-only";
import { provenAttestationsFor } from "@/lib/attest/proven";
// NETWORK-STATE FILTER PACKS — shareable bundles of judgement.
//
// A pack composes EXISTING primitives and nothing else: post rules (the
// Tier A evaluator), persona predicates over the audience-claim index (the
// market's own matching data), and curator subscriptions whose flag actions
// ride along. The import sanitizer refuses anything outside those shapes —
// a new capability is a design change, not an import.
//
// THE READ API'S PRIME DIRECTIVE: disclosure wins. "Does this pack pass this
// persona" answers pass or fail, never WHY — a reason field would let a pack
// double as an oracle over hidden linkages and private claims.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, personaById } from "@/lib/adapters/mock/store";
import graphRaw from "@/seed/data/graph.json";
import { bank } from "@/lib/world";
import { validAnnotations } from "@/lib/curators/annotations";
import { SEED_POSTS } from "@/lib/adapters/mock/store";
import type { AlgoArtifact } from "@/lib/algo/artifact";

export interface FilterPack {
  id: string;
  artifact: AlgoArtifact; // kind === "filter_pack", verified before storage
  importedAt: number;
}

// ------------------------------------------------- the existing claim index

interface PopulationEntry {
  personaId: string;
  tier: number;
  claims: string[];
}

// audiencePopulation is an ARRAY in the seed (my earlier Object.values read
// worked only because arrays are objects) — typed properly here.
// LAYERS_WORLD=empty (lib/world.ts): no seeded audience population
const POPULATION: PopulationEntry[] = bank((
  graphRaw as unknown as { audiencePopulation: PopulationEntry[] }
).audiencePopulation, []);

/** The market's audience-claim primitive, reused verbatim — packs add no new
 * evaluation capability, they point at data the product already holds. */
export function personaHoldsClaim(personaId: string, claim: string): boolean {
  // Attestation pass Gate 3: "attest:<issuer>/<bucket>" — what the persona PROVED this epoch, never the trees
  if (claim.startsWith("attest:")) return provenAttestationsFor(personaId).includes(claim.slice(7));
  const entry = POPULATION.find((e) => e.personaId === personaId);
  return !!entry && entry.claims.includes(claim);
}

// ------------------------------------------------------------- evaluation

/**
 * Does this pack PASS this persona? Pass = the pack does not filter them.
 *
 * Composes: attestation predicates (holding/lacking a claim) and the pack's
 * curator riders (a desk the pack carries flags the persona's cast). Post
 * rules are post-level and do not participate in persona pass/fail.
 *
 * Returns ONLY a boolean. The reason is deliberately not computable from the
 * outside: a fail could be a lacking claim, a held claim, or a curator flag,
 * and distinguishing them would leak exactly the graph facts the disclosure
 * model exists to protect.
 */
export function packPasses(pack: AlgoArtifact, personaId: string): boolean {
  for (const pred of pack.attestationPredicates ?? []) {
    const holds = personaHoldsClaim(personaId, pred.claim);
    if (pred.mode === "lacking" && !holds) return false; // hide accounts lacking X
    if (pred.mode === "holding" && holds) return false; // hide accounts holding X
  }
  for (const sub of pack.curatorSubscriptions ?? []) {
    const feed = state().curatorFeeds.get(sub.feedId);
    if (!feed) continue;
    for (const a of validAnnotations(feed)) {
      if (!a.flagsAuthor) continue;
      const post = SEED_POSTS.find((p) => p.hash === a.targetCastId);
      if (post && post.authorPersonaId === personaId) return false;
    }
  }
  return true;
}

/** Personas a pack filters, across the seeded population. */
export function packFailures(pack: AlgoArtifact): string[] {
  return POPULATION.filter((e) => !packPasses(pack, e.personaId)).map((e) => e.personaId);
}

// --------------------------------------------------------------- storage

export function storePack(artifact: AlgoArtifact): FilterPack {
  const s = state();
  const pack: FilterPack = {
    id: "pack_" + createHash("sha256").update(artifact.signature).digest("hex").slice(0, 12),
    artifact,
    importedAt: Date.now(),
  };
  if (!s.filterPacks.has(pack.id)) s.filterPacks.set(pack.id, pack);
  return pack;
}

export function getPack(id: string): FilterPack | null {
  return state().filterPacks.get(id) ?? null;
}

export function listPacks(): FilterPack[] {
  return [...state().filterPacks.values()];
}

/** Packs attached to a mode (default OFF — attachment is explicit). */
export function packsForMode(modeFilterPackIds: string[] | undefined): FilterPack[] {
  if (!modeFilterPackIds?.length) return [];
  return modeFilterPackIds
    .map((id) => getPack(id))
    .filter(Boolean) as FilterPack[];
}

// ---------------------------------------------------------------- seeding

import { signArtifact } from "@/lib/algo/artifact";
import type { AlgoCard } from "@/lib/algo/service";

export const SEED_PACK_NAME = "Longform Standard";

/** One values-based pack, published by a seeded account onto the algo shelf
 * (same card infrastructure — a pack IS an artifact). Idempotent. */
export function seedFilterPack(): number {
  const s = state();
  const author = [...personaById.values()].find((p) => p.handle === "footnote_feiler");
  if (!author) return 0;
  const already = [...s.algoCards.values()].some((c) => c.artifact.name === SEED_PACK_NAME);
  if (already) return 0;

  const body: Omit<AlgoArtifact, "signature"> = {
    kind: "filter_pack",
    schemaVersion: 1,
    name: SEED_PACK_NAME,
    summary: "Accounts that read past the headline. Hides accounts lacking the longform_reader claim.",
    authorPersonaId: author.id,
    authorHandle: author.handle,
    algoVersion: 1,
    ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 },
    rules: [],
    modeFlags: {},
    attestationPredicates: [{ claim: "longform_reader", mode: "lacking" }],
    createdAt: 1_770_300_000_000,
  };
  // Seeded author signs via fixture keys; null means key wiring is broken —
  // throw loudly rather than seed an unverifiable pack.
  const signature = signArtifact(body);
  if (signature === null)
    throw new Error(`seedFilterPack: no signing key for seeded persona ${author.handle} (${author.id})`);
  const artifact: AlgoArtifact = { ...body, signature };
  const card: AlgoCard = {
    id: "0xalgo" + createHash("sha256").update(artifact.signature).digest("hex").slice(0, 12),
    artifact,
    publishedByPersonaId: author.id,
    publishedAt: artifact.createdAt,
  };
  s.algoCards.set(card.id, card);
  // and file it on the shelf so it is browsable
  const shelf = s.folders.get("folder_algoshelf");
  if (shelf && !shelf.postHashes.includes(card.id)) shelf.postHashes.push(card.id);
  return 1;
}

export async function persistPacks(): Promise<void> {
  await persistNs("filterPacks");
}

// ---------------------------------------------------------------- export

import type { AttestationPredicate, PackCuratorSubscription } from "@/lib/algo/artifact";
import type { Rule } from "@/lib/adapters/types";

/** Build and sign a pack from the builder's composition. Same artifact,
 * same signature, same pipeline as portable algorithms. */
export function exportPack(input: {
  name: string;
  summary: string;
  authorPersonaId: string;
  authorHandle: string;
  rules: Pick<Rule, "name" | "action" | "root">[];
  attestationPredicates: AttestationPredicate[];
  curatorSubscriptions: PackCuratorSubscription[];
  /** MEGA PASS 2 Gate 2: a pack may PIN a lens — applied to a mode that runs the pack and has no lens of its own */
  lens?: import("@/lib/lens/types").LensSpec;
}): AlgoArtifact {
  const body: Omit<AlgoArtifact, "signature"> = {
    kind: "filter_pack",
    schemaVersion: 1,
    name: input.name,
    summary: input.summary,
    authorPersonaId: input.authorPersonaId,
    authorHandle: input.authorHandle,
    algoVersion: 1,
    ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 },
    rules: input.rules,
    modeFlags: {},
    ...(input.attestationPredicates.length ? { attestationPredicates: input.attestationPredicates } : {}),
    ...(input.curatorSubscriptions.length ? { curatorSubscriptions: input.curatorSubscriptions } : {}),
    ...(input.lens ? { lens: input.lens } : {}),
    createdAt: Date.now(),
  };
  // Signer refusal refuses the export — an unsigned pack never leaves here.
  const signature = signArtifact(body);
  if (signature === null)
    throw new Error(`cannot sign as ${input.authorPersonaId} — no key resolves, export refused`);
  return { ...body, signature };
}
