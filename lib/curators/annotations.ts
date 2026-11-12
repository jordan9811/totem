import "server-only";
// CURATOR SUBSCRIPTIONS — external annotation feeds.
//
// The design constraint that matters: annotations flow into the EXISTING
// surfaces (debunk indicator, notes reinjection), tagged with curator
// identity. There is no parallel display system, because a second
// fact-check surface is how users learn to ignore both.
//
// The safety constraint that matters more: an annotation with fewer than
// `threshold` VALID signers does not render anywhere. Not smaller, not
// greyed out — absent. A 1-of-3 multisig annotation is not "one journalist's
// opinion", it is an unissued statement, and rendering it would let any
// single compromised key speak for a desk of three.
import { createHash } from "@/lib/platform/crypto";
import { SEED_PERSONAS, SEED_POSTS, state, persistNs } from "@/lib/adapters/mock/store";
import { signForPersona, publicKeyForPersona } from "@/lib/identity/keys";
import { verifyCanonical } from "@/lib/crypto/ed25519";

export interface AnnotationSigner {
  personaId: string;
  signature: string;
}

export interface Annotation {
  id: string;
  targetCastId: string;
  claim: string;
  evidenceLink: string;
  signers: AnnotationSigner[];
  threshold: number;
  timestamp: number;
  /** the curator asserts the AUTHOR of the target is a repeat offender —
   * this is what demote / auto-block subscriptions act on */
  flagsAuthor?: boolean;
  /** curator-attested refutation: the desk attests fromCastId refutes the
   * target. Rides the same signed shape — Call Option A consumes it. */
  edge?: { fromCastId: string; toCastId: string; type: "refutes" | "probes" };
}

export interface CuratorFeed {
  id: string;
  name: string;
  /** the accounts whose signatures count toward the threshold */
  curatorPersonaIds: string[];
  threshold: number;
  annotations: Annotation[];
}

export type SubscriptionAction = "badge" | "demote" | "autoblock";

export interface Subscription {
  feedId: string;
  action: SubscriptionAction;
}

// ---------------------------------------------------------------- signing

/** Canonical form covers everything EXCEPT the signer list itself. */
function canonical(a: Omit<Annotation, "signers" | "id">): string {
  return [
    a.targetCastId,
    a.claim,
    a.evidenceLink,
    String(a.threshold),
    String(a.timestamp),
    a.flagsAuthor ? "flags" : "",
    a.edge ? `${a.edge.fromCastId}>${a.edge.toCastId}:${a.edge.type}` : "",
  ].join("|");
}

/** Ed25519 over the canonical body, as the signer persona. Null = no key
 * speaks for that persona: the caller REFUSES the co-sign — an unsigned
 * co-sign is never stored. */
export function signAnnotation(
  a: Omit<Annotation, "signers" | "id">,
  signerPersonaId: string
): string | null {
  return signForPersona(signerPersonaId, canonical(a));
}

/** Per-signer verification against the signer's real public key. No key
 * resolvable for the persona = false — same answer as a forged signature. */
export function verifyAnnotationSig(
  a: Omit<Annotation, "signers" | "id">,
  signer: AnnotationSigner
): boolean {
  const pub = publicKeyForPersona(signer.personaId);
  return pub !== null && verifyCanonical(signer.signature, canonical(a), pub);
}

/**
 * Count VALID signers: listed on the feed's curator set, carrying a
 * signature that verifies. A forged or off-desk signature simply does not
 * count — and if the survivors are under threshold, the annotation is
 * invalid.
 */
export function isValidAnnotation(a: Annotation, feed: CuratorFeed): boolean {
  const valid = a.signers.filter(
    (s) => feed.curatorPersonaIds.includes(s.personaId) && verifyAnnotationSig(a, s)
  );
  return valid.length >= a.threshold;
}

/** Only the annotations that are allowed to exist, per feed. */
export function validAnnotations(feed: CuratorFeed): Annotation[] {
  return feed.annotations.filter((a) => isValidAnnotation(a, feed));
}

// ----------------------------------------------------------- subscriptions

export function subscriptionsFor(personaId: string): Subscription[] {
  return state().curatorSubs.get(personaId) ?? [];
}

export async function setSubscription(
  personaId: string,
  feedId: string,
  action: SubscriptionAction | null
): Promise<Subscription[]> {
  const s = state();
  const current = (s.curatorSubs.get(personaId) ?? []).filter((x) => x.feedId !== feedId);
  if (action) current.push({ feedId, action });
  s.curatorSubs.set(personaId, current);
  await persistNs("curatorSubs");
  return current;
}

/** Every valid annotation from feeds this viewer subscribes to. */
export function subscribedAnnotations(
  personaId: string
): { annotation: Annotation; feed: CuratorFeed; action: SubscriptionAction }[] {
  const s = state();
  const out: { annotation: Annotation; feed: CuratorFeed; action: SubscriptionAction }[] = [];
  for (const sub of subscriptionsFor(personaId)) {
    const feed = s.curatorFeeds.get(sub.feedId);
    if (!feed) continue;
    for (const annotation of validAnnotations(feed)) {
      out.push({ annotation, feed, action: sub.action });
    }
  }
  return out;
}

/** Authors flagged by subscribed feeds, keyed by what the viewer chose to do
 * about it. Derived at read time from valid annotations only — unsubscribing
 * reverses everything on the next render because nothing is ever persisted. */
export function flaggedAuthors(personaId: string): Map<string, SubscriptionAction> {
  const out = new Map<string, SubscriptionAction>();
  for (const { annotation, action } of subscribedAnnotations(personaId)) {
    if (!annotation.flagsAuthor) continue;
    const post = SEED_POSTS.find((p) => p.hash === annotation.targetCastId);
    if (!post) continue;
    // strongest action wins if two feeds flag the same author
    const rank = { badge: 0, demote: 1, autoblock: 2 };
    const prev = out.get(post.authorPersonaId);
    if (!prev || rank[action] > rank[prev]) out.set(post.authorPersonaId, action);
  }
  return out;
}

// ---------------------------------------------------------------- seeding

export const FEED_FOOTNOTE = "curator_footnote";
export const FEED_RECORDS = "curator_recordsdesk";

const idOf = (h: string) => SEED_PERSONAS.find((p) => p.handle === h)?.id ?? "";

function build(
  base: Omit<Annotation, "signers" | "id">,
  signedBy: string[],
  forgeLast = false
): Annotation {
  const signers: AnnotationSigner[] = signedBy.map((pid, i) => {
    if (forgeLast && i === signedBy.length - 1) return { personaId: pid, signature: "forged_signature" };
    const sig = signAnnotation(base, pid);
    // curators are seeded personas with fixture keys — a null here is a
    // broken seed universe, not a runtime condition. Fail loud, name names.
    if (sig === null) throw new Error(`seedCuratorFeeds: no signing key for seeded persona ${pid}`);
    return { personaId: pid, signature: sig };
  });
  const id = "ann_" + createHash("sha256").update(canonical(base)).digest("hex").slice(0, 12);
  return { ...base, signers, id };
}

/** Idempotent. Two curators: a single author, and a 2-of-3 desk. */
export function seedCuratorFeeds(): number {
  const s = state();
  if (s.curatorFeeds.size > 0) return 0;

  const feiler = idOf("footnote_feiler");
  const desk = [idOf("todayinruins"), idOf("marginalia_mo"), idOf("archive_annette")];

  const post = (pred: (p: (typeof SEED_POSTS)[number]) => boolean) => SEED_POSTS.find(pred);
  const storyPost = post((p) => p.storyId === "story_idverify_breach" && !p.replyToHash);
  const feilerPost = post((p) => p.authorPersonaId === feiler && !p.replyToHash);
  // A post the viewer engaged with that has NO community note: the
  // injection queue de-duplicates by underlying post, first writer wins, so
  // an annotation seeded onto an already-noted post would be dropped as a
  // duplicate — correct queue behaviour that made the demo invisible.
  const likedPost = post((p) => p.hash === "0xas0377");
  const basisPost = post((p) => p.authorPersonaId === idOf("basisrisk") && !p.replyToHash);
  const storyPost2 = post(
    (p) => p.storyId === "story_idverify_breach" && !p.replyToHash && p.hash !== storyPost?.hash
  );
  if (!storyPost || !likedPost || !basisPost || !storyPost2) return 0;

  const T = 1_770_100_000_000;

  s.curatorFeeds.set(FEED_FOOTNOTE, {
    id: FEED_FOOTNOTE,
    name: "Footnote Desk",
    curatorPersonaIds: [feiler],
    threshold: 1,
    annotations: [
      build(
        {
          targetCastId: storyPost.hash,
          claim: "The breach total repeated here counts test accounts; the filing says 12k affected, not 40k.",
          evidenceLink: "https://example.org/filings/idverify-8k",
          threshold: 1,
          timestamp: T,
          ...(feilerPost
            ? { edge: { fromCastId: feilerPost.hash, toCastId: storyPost.hash, type: "refutes" as const } }
            : {}),
        },
        [feiler]
      ),
    ],
  });

  s.curatorFeeds.set(FEED_RECORDS, {
    id: FEED_RECORDS,
    name: "Records Desk (2-of-3)",
    curatorPersonaIds: desk,
    threshold: 2,
    annotations: [
      // VALID: two of three sign an annotation on a post the viewer engaged with
      build(
        {
          targetCastId: likedPost.hash,
          claim: "Image in this post is a 2019 archive photo, not the event described.",
          evidenceLink: "https://example.org/archive/2019-orion",
          threshold: 2,
          timestamp: T + 1000,
        },
        [desk[0], desk[1]]
      ),
      // VALID + flags the author: the demote / auto-block subject. Targets a
      // basisrisk post deliberately — he has a PUBLIC linkage to duskorbiter,
      // so auto-block must fan out across the resolvable sibling.
      build(
        {
          targetCastId: basisPost.hash,
          claim: "Third repetition of a corrected figure after two published corrections.",
          evidenceLink: "https://example.org/corrections/basis-risk",
          threshold: 2,
          timestamp: T + 2000,
          flagsAuthor: true,
        },
        [desk[1], desk[2]]
      ),
      // INVALID: only ONE of three signed. This annotation must render
      // NOWHERE — the seeded proof that sub-threshold fails closed.
      build(
        {
          targetCastId: storyPost2.hash,
          claim: "UNISSUED: single-signer draft that must never render.",
          evidenceLink: "https://example.org/draft",
          threshold: 2,
          timestamp: T + 3000,
          flagsAuthor: true,
        },
        [desk[0]]
      ),
    ],
  });

  return s.curatorFeeds.size;
}
