import "server-only";
// REFUTATION EDGES — typed claims about claims.
//
// An edge says one cast REFUTES (or merely PROBES) another, and it always
// says who is asserting that: the reply's author, or a curator desk through
// the Gate 4 annotation machinery. The distinction is load-bearing —
// "I say this refutes you" is testimony, "a 2-of-3 desk attests this refutes
// you" is a checked claim, and STANDING treats them differently.
//
// Standing — the unrefuted last word — is weighted by author reputation
// TIER, never by reply volume. A low-tier account declaring refutation ten
// times has said one thing ten times; it does not outweigh the claim. What
// takes standing: an author-declared refutation from an EQUAL-OR-HIGHER
// tier author, or a curator-attested refutation from a subscribed desk.
import { createHash } from "@/lib/platform/crypto";
import { SEED_POSTS, personaById, state, persistNs } from "@/lib/adapters/mock/store";
import { subscribedAnnotations } from "@/lib/curators/annotations";
import { accountPublicKey, signAsAccount } from "@/lib/identity/accountKeys";
import { verifyCanonical } from "@/lib/crypto/ed25519";

export type EdgeType = "refutes" | "probes";
export type DeclaredBy = "author" | "curator";

export interface RefutationEdge {
  id: string;
  fromCastId: string;
  toCastId: string;
  type: EdgeType;
  declaredBy: DeclaredBy;
  /** the persona asserting it (reply author, or the curator feed id) */
  assertedBy: string;
  timestamp: number;
  /** GATE 0 (Tier B): authorship verified — the declarer's persona matches
   * the from-cast's author. Unverified author edges are recorded (they are
   * testimony someone gave) but NEVER count toward standing. Curator edges
   * carry their own verification: the multisig threshold.
   * CRYPTO PASS: for author edges this boolean is only the declare-time
   * AUTHORSHIP anchor — it is never sufficient alone. Standing re-verifies
   * the signature at read time (authorEdgeSigVerifies). */
  verified: boolean;
  /** Ed25519 (hex) by assertedBy over edgeCanonical. Null ONLY for
   * curator-attested edges: their authority is the co-signed annotation,
   * threshold-verified in the annotations module — not a per-edge author
   * signature. An author edge whose signature is absent or does not verify
   * holds NO standing (fail closed). */
  signature: string | null;
}

export function edgeId(fromCastId: string, toCastId: string, assertedBy: string): string {
  return (
    "re_" +
    createHash("sha256").update(`${fromCastId}|${toCastId}|${assertedBy}`).digest("hex").slice(0, 16)
  );
}

/** THE canonical form an author edge is signed over — versioned, and it pins
 * the whole assertion: what refutes what, how, said by whom, when. Change any
 * field and the signature breaks. */
export function edgeCanonical(
  e: Pick<RefutationEdge, "fromCastId" | "toCastId" | "type" | "assertedBy" | "timestamp">
): string {
  return ["layers-refutation/1", e.fromCastId, e.toCastId, e.type, e.assertedBy, String(e.timestamp)].join("|");
}

/** Read-time integrity for AUTHOR edges. The stored `verified` boolean is no
 * longer trusted on its own — the signature must verify NOW against the
 * asserter's public key. No signature (old persisted edges predate the
 * field), no resolvable key, or a bad signature are all the same answer:
 * the edge holds nothing. */
export function authorEdgeSigVerifies(edge: RefutationEdge): boolean {
  if (!edge.signature) return false;
  // ACCOUNT key space: the asserter is a cast author (a session/account
  // persona), whose key resolves deterministically by id — so this
  // verifies identically after a restart, and a tampered field
  // (assertedBy, from/to, type, timestamp) breaks it.
  return verifyCanonical(edge.signature, edgeCanonical(edge), accountPublicKey(edge.assertedBy));
}

/**
 * Who authored this cast, as far as the evaluation layer can establish.
 *  - seeded posts: the seed's authorPersonaId
 *  - local casts: the persona marker embedded in the cast text at creation
 *  - anything else: null — unresolvable authorship can never verify
 */
export async function castAuthor(castId: string): Promise<string | null> {
  const seeded = SEED_POSTS.find((p) => p.hash === castId);
  if (seeded) return seeded.authorPersonaId;
  try {
    // dynamic import breaks the static cycle with the phase-1 data store
    const { findLocalCast } = await import("@/lib/data");
    const local = findLocalCast(castId);
    if (local) {
      const m = /layers:persona:(\S+)/.exec(local.text ?? "");
      if (m) return m[1];
      return local.personaId ?? null;
    }
  } catch {
    /* unresolvable is unverified */
  }
  return null;
}

export async function declareEdge(
  input: Omit<RefutationEdge, "id" | "timestamp" | "verified" | "signature">
): Promise<RefutationEdge | null> {
  const s = state();
  // ENFORCED HERE, in the evaluation layer, not the UI: an author-declared
  // edge is verified only when the declarer IS the from-cast's author. A
  // client can still record its testimony; it cannot make the testimony
  // count as something it is not.
  const verified =
    input.declaredBy === "curator"
      ? true // curator edges verify via the multisig threshold upstream
      : (await castAuthor(input.fromCastId)) === input.assertedBy;
  const edge: RefutationEdge = {
    ...input,
    verified,
    id: edgeId(input.fromCastId, input.toCastId, input.assertedBy),
    timestamp: Date.now(),
    signature: null, // curator edges stay null — their annotation is the authority
  };
  if (input.declaredBy === "author") {
    // CRYPTO PASS: the asserter signs its own testimony over the account
    // key space (a cast author is a session/account persona). Integrity,
    // not authorization — the `verified` boolean above already gates who
    // may hold standing; the signature makes tampering detectable at read
    // time. Every account id is signable, so this never refuses; a forged
    // edge is stored as unverified testimony, exactly as before.
    edge.signature = signAsAccount(input.assertedBy, edgeCanonical(edge));
  }
  if (!s.refutationEdges.has(edge.id)) s.refutationEdges.set(edge.id, edge);
  await persistNs("refutationEdges");
  return edge;
}

export function edgesFor(toCastId: string): RefutationEdge[] {
  return [...state().refutationEdges.values()].filter((e) => e.toCastId === toCastId);
}

export function edgesFrom(fromCastId: string): RefutationEdge[] {
  return [...state().refutationEdges.values()].filter((e) => e.fromCastId === fromCastId);
}

/** Curator-attested edges ride the annotation shape: a valid annotation may
 * carry an `edge`, and only VALID annotations from SUBSCRIBED feeds count. */
export function curatorEdgesFor(viewerPersonaId: string): RefutationEdge[] {
  const out: RefutationEdge[] = [];
  for (const { annotation, feed } of subscribedAnnotations(viewerPersonaId)) {
    const e = (annotation as { edge?: { fromCastId: string; toCastId: string; type: EdgeType } }).edge;
    if (!e) continue;
    out.push({
      id: edgeId(e.fromCastId, e.toCastId, feed.id),
      fromCastId: e.fromCastId,
      toCastId: e.toCastId,
      type: e.type,
      declaredBy: "curator",
      assertedBy: feed.id,
      timestamp: annotation.timestamp,
      verified: true, // threshold-checked upstream: only valid annotations reach here
      signature: null, // per the split: the co-signed annotation IS the authority
    });
  }
  return out;
}

function tierOf(personaId: string | undefined): number {
  return personaId ? personaById.get(personaId)?.tier ?? 1 : 1;
}

/**
 * Does this cast still HOLD standing for this viewer?
 *
 * Refuted only by: (a) an author-declared refutation whose declaring author's
 * TIER is >= the claim author's tier, or (b) a curator-attested refutation
 * from a feed the viewer subscribes to. Volume appears nowhere in this
 * function — ten sub-tier declarations carry exactly the weight of one.
 */
export function holdsStanding(castId: string, viewerPersonaId: string): boolean {
  const post = SEED_POSTS.find((p) => p.hash === castId);
  const claimTier = tierOf(post?.authorPersonaId);
  for (const edge of edgesFor(castId)) {
    if (edge.type !== "refutes") continue;
    if (!edge.verified) continue; // unverified testimony never takes standing
    if (edge.declaredBy === "author") {
      // CRYPTO PASS: a stored boolean is not a proof — the author edge must
      // ALSO carry a signature that verifies AT READ TIME. The signature pins
      // fromCastId + assertedBy (and type, timestamp), so a tampered edge
      // breaks it. Re-checking cast authorship itself would need the async
      // castAuthor lookup, which does not fit this sync path — so the
      // declare-time authorship check (`verified`, above) remains the
      // authorship anchor, and the signature is the integrity anchor.
      if (!authorEdgeSigVerifies(edge)) continue; // unverifiable = absent
      if (tierOf(edge.assertedBy) >= claimTier) return false;
    }
  }
  for (const edge of curatorEdgesFor(viewerPersonaId)) {
    if (edge.type === "refutes" && edge.toCastId === castId) return false;
  }
  return true;
}

// ------------------------------------------------------- concur / dispute

/** One-tap feedback ON THE ANNOTATION ("was this actually unaddressed?"),
 * feeding a per-curator accuracy tally. One vote per persona, switchable. */
export async function voteAnnotation(
  annotationId: string,
  personaId: string,
  vote: "concur" | "dispute"
): Promise<{ concur: number; dispute: number }> {
  const s = state();
  const entry = s.annotationVotes.get(annotationId) ?? { concur: [], dispute: [] };
  entry.concur = entry.concur.filter((p) => p !== personaId);
  entry.dispute = entry.dispute.filter((p) => p !== personaId);
  entry[vote].push(personaId);
  s.annotationVotes.set(annotationId, entry);
  await persistNs("annotationVotes");
  return { concur: entry.concur.length, dispute: entry.dispute.length };
}

export function annotationTally(annotationId: string): { concur: number; dispute: number } {
  const entry = state().annotationVotes.get(annotationId);
  return { concur: entry?.concur.length ?? 0, dispute: entry?.dispute.length ?? 0 };
}

/** Accuracy per curator feed: concurred / voted, across its annotations. */
export function curatorAccuracy(feedId: string): { concur: number; dispute: number; accuracy: number | null } {
  const feed = state().curatorFeeds.get(feedId);
  if (!feed) return { concur: 0, dispute: 0, accuracy: null };
  let concur = 0;
  let dispute = 0;
  for (const a of feed.annotations) {
    const t = annotationTally(a.id);
    concur += t.concur;
    dispute += t.dispute;
  }
  const total = concur + dispute;
  return { concur, dispute, accuracy: total ? Math.round((concur / total) * 100) : null };
}

// ---------------------------------------------------------------- seeding

/**
 * THE FLOOD SCENARIO. A tier-9 claim; a low-tier account declares refutation
 * against it ten times. Under king-of-the-hill the claim must keep standing —
 * the seeded proof that volume is not weight. Plus one curator-attested
 * refutation elsewhere, which DOES take standing for subscribers.
 */
export function seedRefutations(): number {
  const s = state();
  if (s.refutationEdges.size > 0) return 0;
  const byHandle = (h: string) => [...personaById.values()].find((p) => p.handle === h);
  // The most RECENT root post: the flood proof needs the claim inside the
  // ranked window, and the oldest post never gets there.
  const claim = SEED_POSTS.filter(
    (p) => p.authorPersonaId === byHandle("basisrisk")?.id && !p.replyToHash
  ).sort((a, b) => a.minutesAgo - b.minutesAgo)[0];
  const flooder = byHandle("airdropintern");
  if (!claim || !flooder) return 0;
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const edge: RefutationEdge = {
      id: edgeId(`flood_${i}`, claim.hash, flooder.id),
      fromCastId: `flood_${i}`,
      toCastId: claim.hash,
      type: "refutes",
      declaredBy: "author",
      assertedBy: flooder.id,
      timestamp: 1_770_200_000_000 + i,
      // synthetic from-casts fail the authorship check by construction —
      // the seeded flood is now impotent twice over: tier AND authorship
      verified: false,
      signature: null,
    };
    // CRYPTO PASS: even the flood is REAL testimony — the flooder genuinely
    // signs it (its account key, which for a seeded persona is the fixture
    // key accountPublicKey verifies against); it fails on authorship and
    // tier, not on a forged signature.
    edge.signature = signAsAccount(flooder.id, edgeCanonical(edge));
    s.refutationEdges.set(edge.id, edge);
    n++;
  }
  return n;
}

export const FLOOD_TARGET_AUTHOR = "basisrisk";
export const FLOODER = "airdropintern";
