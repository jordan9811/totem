import "server-only";
// CURATOR ISSUANCE — how an annotation comes to exist.
//
// The display side (annotations.ts) already enforces the hard rule: below
// threshold, an annotation renders NOWHERE. This module is the other half —
// draft → invite co-signers → collect signatures → threshold → live — and
// its own rule is the mirror image: a DRAFT is visible only to the people
// invited to sign it. Not to the desk's other members, not to subscribers,
// not to an adversarial fetcher with the right feed id. The moment enough
// valid signatures land, the draft issues into the feed's annotation list
// and every existing surface picks it up with zero new display code.
//
// Curation happens AS a persona. The payloads here carry persona ids and
// handles only — the root-leak grep scans this surface like any other.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, personaById, SEED_PERSONAS } from "@/lib/adapters/mock/store";
import {
  signAnnotation,
  verifyAnnotationSig,
  isValidAnnotation,
  type Annotation,
  type AnnotationSigner,
  type CuratorFeed,
  FEED_RECORDS,
} from "./annotations";

export interface AnnotationDraft {
  id: string;
  feedId: string;
  /** the annotation body being signed — canonical form is fixed at draft
   * creation, so every signature signs the same bytes */
  base: Omit<Annotation, "signers" | "id">;
  /** persona ids invited to co-sign; visibility boundary */
  invited: string[];
  signers: AnnotationSigner[];
  createdBy: string;
  status: "pending" | "issued";
  issuedAnnotationId?: string;
}

function draftId(base: Omit<Annotation, "signers" | "id">, feedId: string): string {
  return (
    "draft_" +
    createHash("sha256")
      .update(feedId + "|" + base.targetCastId + "|" + base.claim + "|" + String(base.timestamp))
      .digest("hex")
      .slice(0, 12)
  );
}

/** Valid signatures only: on-desk signer whose signature verifies against
 * the draft's canonical body. Forged or off-desk signatures never count. */
function validSignerCount(draft: AnnotationDraft, feed: CuratorFeed): number {
  return draft.signers.filter(
    (s) => feed.curatorPersonaIds.includes(s.personaId) && verifyAnnotationSig(draft.base, s)
  ).length;
}

export async function createDraft(input: {
  feedId: string;
  byPersona: string;
  targetCastId: string;
  claim: string;
  evidenceLink: string;
  flagsAuthor?: boolean;
  edge?: Annotation["edge"];
  /** defaults to the rest of the desk */
  invite?: string[];
}): Promise<AnnotationDraft> {
  const s = state();
  const feed = s.curatorFeeds.get(input.feedId);
  if (!feed) throw new Error("unknown curator feed");
  if (!feed.curatorPersonaIds.includes(input.byPersona))
    throw new Error("only desk members draft annotations");
  const base: Omit<Annotation, "signers" | "id"> = {
    targetCastId: input.targetCastId,
    claim: input.claim,
    evidenceLink: input.evidenceLink,
    threshold: feed.threshold,
    timestamp: Date.now(),
    ...(input.flagsAuthor ? { flagsAuthor: true } : {}),
    ...(input.edge ? { edge: input.edge } : {}),
  };
  // the author signs what they wrote, at the moment they write it — no
  // key for the persona means no draft, never a draft with an unsigned author
  const authorSig = signAnnotation(base, input.byPersona);
  if (authorSig === null) throw new Error("no signing key for this persona");
  const draft: AnnotationDraft = {
    id: draftId(base, feed.id),
    feedId: feed.id,
    base,
    invited: input.invite ?? feed.curatorPersonaIds.filter((p) => p !== input.byPersona),
    signers: [{ personaId: input.byPersona, signature: authorSig }],
    createdBy: input.byPersona,
    status: "pending",
  };
  s.annotationDrafts.set(draft.id, draft);
  await persistNs("annotationDrafts");
  // a 1-of-1 desk issues immediately — the threshold is already met
  await maybeIssue(draft, feed);
  return draft;
}

/**
 * The visibility boundary. A draft exists for its author, its invitees, and
 * anyone who has signed it. For everyone else — including other members of
 * the same desk who were not invited — it is NOT DATA THEY RECEIVE. The
 * adversarial test fetches as a desk member who wasn't invited and asserts
 * absence.
 */
export function draftsVisibleTo(personaId: string): AnnotationDraft[] {
  return [...state().annotationDrafts.values()].filter(
    (d) =>
      d.createdBy === personaId ||
      d.invited.includes(personaId) ||
      d.signers.some((s) => s.personaId === personaId)
  );
}

async function maybeIssue(draft: AnnotationDraft, feed: CuratorFeed): Promise<void> {
  if (draft.status === "issued") return;
  if (validSignerCount(draft, feed) < feed.threshold) return;
  const annotation: Annotation = {
    ...draft.base,
    signers: draft.signers,
    id:
      "ann_" +
      createHash("sha256")
        .update(draft.id + "|issued")
        .digest("hex")
        .slice(0, 12),
  };
  // belt and braces: what we are about to publish must satisfy the display
  // side's own validator — if it would not render, do not issue it
  if (!isValidAnnotation(annotation, feed)) return;
  feed.annotations.push(annotation);
  draft.status = "issued";
  draft.issuedAnnotationId = annotation.id;
  await persistNs("curatorFeeds");
  await persistNs("annotationDrafts");
}

/** Sign a draft. Only invited desk members (or the author) may sign;
 * signing twice is idempotent; the threshold moment issues the annotation
 * into the live feed. */
export async function signDraft(draftId: string, byPersona: string): Promise<AnnotationDraft> {
  const s = state();
  const draft = s.annotationDrafts.get(draftId);
  if (!draft) throw new Error("unknown draft");
  const feed = s.curatorFeeds.get(draft.feedId);
  if (!feed) throw new Error("unknown curator feed");
  const allowed =
    draft.createdBy === byPersona || draft.invited.includes(byPersona);
  if (!allowed) throw new Error("not invited to sign this draft");
  if (!feed.curatorPersonaIds.includes(byPersona))
    throw new Error("only desk members sign annotations");
  if (draft.status === "issued") return draft; // idempotent after the fact
  if (!draft.signers.some((x) => x.personaId === byPersona)) {
    const sig = signAnnotation(draft.base, byPersona);
    // no key = this persona cannot co-sign; refuse rather than store unsigned
    if (sig === null) throw new Error("no signing key for this persona");
    draft.signers.push({ personaId: byPersona, signature: sig });
  }
  await maybeIssue(draft, feed);
  await persistNs("annotationDrafts");
  return draft;
}

/** Signature progress for the UI: who has signed, who is awaited. */
export function draftProgress(draft: AnnotationDraft): {
  signed: string[];
  awaiting: string[];
  threshold: number;
} {
  const feed = state().curatorFeeds.get(draft.feedId);
  const valid = draft.signers
    .filter(
      (s) => feed?.curatorPersonaIds.includes(s.personaId) && verifyAnnotationSig(draft.base, s)
    )
    .map((s) => s.personaId);
  return {
    signed: valid,
    awaiting: draft.invited.filter((p) => !valid.includes(p)),
    threshold: feed?.threshold ?? draft.base.threshold,
  };
}

/** The curator's public record: desks they sit on, annotations issued with
 * their signature, and the community's verdict on those desks. */
export function curatorRecordFor(personaId: string): {
  feedId: string;
  feedName: string;
  issuedSigned: number;
  accuracy: { concur: number; dispute: number; accuracy: number | null };
}[] {
  const out = [];
  for (const feed of state().curatorFeeds.values()) {
    if (!feed.curatorPersonaIds.includes(personaId)) continue;
    // lazy import avoided: annotationTally lives in refutation/edges which
    // imports nothing from here; a direct import would be safe but the
    // record only needs the per-feed roll-up
    // credit requires the persona's OWN signature to verify — presence in
    // the signer list alone would let a forged entry pad a public record
    const issuedSigned = feed.annotations.filter(
      (a) =>
        isValidAnnotation(a, feed) &&
        a.signers.some((s) => s.personaId === personaId && verifyAnnotationSig(a, s))
    ).length;
    out.push({
      feedId: feed.id,
      feedName: feed.name,
      issuedSigned,
      accuracy: accuracyOf(feed),
    });
  }
  return out;
}

function accuracyOf(feed: CuratorFeed) {
  let concur = 0;
  let dispute = 0;
  for (const a of feed.annotations) {
    const t = state().annotationVotes.get(a.id);
    concur += t?.concur.length ?? 0;
    dispute += t?.dispute.length ?? 0;
  }
  const total = concur + dispute;
  return { concur, dispute, accuracy: total ? Math.round((concur / total) * 100) : null };
}

// ---------------------------------------------------------------- seeding

/**
 * The mid-flight 2-of-3: todayinruins drafted an annotation on the Records
 * Desk and signed it; marginalia_mo and archive_annette are invited; ONE
 * more signature issues it. The threshold moment is sitting on the desk
 * page waiting to be demoed. Idempotent.
 */
export async function seedIssuanceDraft(): Promise<number> {
  const s = state();
  if (s.annotationDrafts.size > 0) return 0;
  const idOf = (h: string) => SEED_PERSONAS.find((p) => p.handle === h)?.id ?? "";
  const author = idOf("todayinruins");
  const feed = s.curatorFeeds.get(FEED_RECORDS);
  if (!author || !feed) return 0;
  const base: Omit<Annotation, "signers" | "id"> = {
    targetCastId: "0xcr0013",
    claim:
      "The restaking yield quoted here annualizes a single epoch; the trailing 30-day figure is 4.1%, not 11%.",
    evidenceLink: "https://example.org/records/restaking-yield",
    threshold: feed.threshold,
    timestamp: 1_770_400_000_000,
  };
  // todayinruins is a seeded persona with a fixture key — null is a broken
  // seed universe, and a silent skip would just fail red downstream anyway
  const authorSig = signAnnotation(base, author);
  if (authorSig === null)
    throw new Error(`seedIssuanceDraft: no signing key for seeded persona ${author} (todayinruins)`);
  const draft: AnnotationDraft = {
    id: draftId(base, feed.id),
    feedId: feed.id,
    base,
    invited: [idOf("marginalia_mo"), idOf("archive_annette")].filter(Boolean),
    signers: [{ personaId: author, signature: authorSig }],
    createdBy: author,
    status: "pending",
  };
  s.annotationDrafts.set(draft.id, draft);
  return 1;
}

const handleOf = (id: string) => personaById.get(id)?.handle ?? id;
export { handleOf as curatorHandleOf };
