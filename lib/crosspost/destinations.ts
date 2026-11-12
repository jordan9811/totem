import "server-only";
// THE DESTINATION ADAPTER — the interface the interop pass implements
// against. Everything protocol-specific lives behind it; the composer knows
// only capabilities, costs, and refs.
//
// DOCUMENTED CONTRACT (REPORT-B carries this verbatim):
//
//   interface DestinationAdapter {
//     id: string;                       // stable, e.g. "x_mock"
//     displayName: string;
//     capabilities: {
//       maxLength: number;              // hard cap, chars
//       media: boolean;                 // accepts media attachments
//       links: boolean;                 // allows URLs in the body
//       threads: boolean;               // accepts multi-part posts
//     };
//     publish(post): Promise<{ externalRef: string }>;   // throws on refusal
//     costEstimate(post): Promise<{ amount: number; currency: string }>;
//       // amount in the destination's smallest display unit (USD dollars
//       // here); deterministic for a given post shape
//   }
//
// Mock behaviours mirror real cost structure, not real networking: the X
// mock's rate card makes LINK POSTS 13x a plain post — that is the 2026
// shape, and surfacing it BEFORE send is the product point.
import { createHash } from "@/lib/platform/crypto";
import { withMockLatency } from "../adapters/mockUtils";

export interface CrosspostDraft {
  text: string;
  hasMedia: boolean;
  /** URLs detected in the body */
  links: string[];
}

export interface DestinationCapabilities {
  maxLength: number;
  media: boolean;
  links: boolean;
  threads: boolean;
}

export interface DestinationAdapter {
  id: string;
  displayName: string;
  capabilities: DestinationCapabilities;
  publish(post: CrosspostDraft): Promise<{ externalRef: string }>;
  costEstimate(post: CrosspostDraft): Promise<{ amount: number; currency: string }>;
}

/** What a destination would actually receive — computed BEFORE send and
 * shown to the user. Content never degrades silently. */
export interface DegradationPreview {
  destinationId: string;
  truncated: boolean;
  deliveredText: string;
  mediaDropped: boolean;
  linksDropped: boolean;
}

export function degradeFor(dest: DestinationAdapter, draft: CrosspostDraft): DegradationPreview {
  let deliveredText = draft.text;
  let linksDropped = false;
  if (!dest.capabilities.links && draft.links.length) {
    for (const l of draft.links) deliveredText = deliveredText.replace(l, "").trim();
    linksDropped = true;
  }
  const truncated = deliveredText.length > dest.capabilities.maxLength;
  if (truncated) deliveredText = deliveredText.slice(0, dest.capabilities.maxLength - 1) + "…";
  return {
    destinationId: dest.id,
    truncated,
    deliveredText,
    mediaDropped: draft.hasMedia && !dest.capabilities.media,
    linksDropped,
  };
}

export function detectLinks(text: string): string[] {
  return text.match(/https?:\/\/\S+/g) ?? [];
}

// ------------------------------------------------------------------ mocks

let refSeq = 0;

/** What each mock destination last received — the degradation preview's
 * contract is "this is what the destination gets", and the test holds the
 * mock to it rather than trusting the preview to describe itself. */
export const lastReceived = new Map<string, CrosspostDraft>();

/** X mock. The 2026 rate-card SHAPE: plain posts cheap, link posts 13x. */
export const xMockDestination: DestinationAdapter = {
  id: "x_mock",
  displayName: "X (mock)",
  capabilities: { maxLength: 280, media: true, links: true, threads: true },
  async publish(post) {
    return withMockLatency(
      () => {
        lastReceived.set("x_mock", post);
        return { externalRef: `x:post:${Date.now().toString(36)}:${++refSeq}` };
      },
      { label: "destination.x.publish" }
    );
  },
  async costEstimate(post) {
    return withMockLatency(
      () => {
        const base = 0.015;
        // LINK POSTS 13x — the rate card's whole personality. Three-decimal
        // rounding: two decimals turned $0.015 into $0.02, quietly changing
        // the rate card by 33%.
        const amount = post.links.length > 0 ? base * 13 : base;
        return { amount: Math.round(amount * 1000) / 1000, currency: "USD" };
      },
      { label: "destination.x.cost" }
    );
  },
};

/** TikTok mock: long captions, media-first, NO links in the body. */
export const tiktokMockDestination: DestinationAdapter = {
  id: "tiktok_mock",
  displayName: "TikTok (mock)",
  capabilities: { maxLength: 2200, media: true, links: false, threads: false },
  async publish(post) {
    return withMockLatency(
      () => {
        lastReceived.set("tiktok_mock", post);
        return { externalRef: `tiktok:video:${Date.now().toString(36)}:${++refSeq}` };
      },
      { label: "destination.tiktok.publish" }
    );
  },
  async costEstimate() {
    return withMockLatency(() => ({ amount: 0, currency: "USD" }), {
      label: "destination.tiktok.cost",
    });
  },
};

/** THE REAL X DESTINATION (X interop Gate 1 binds it; Gate 3 hardens it
 * with the spend ledger). Capabilities honest to X; costs from the rate
 * card config — updating rates is one edit to lib/x/ratecard.json.
 * publish() with ENABLE_X_WRITE unset THROWS loudly, never no-ops (Neynar
 * write convention). */
import rateCard from "../x/ratecard.json";

export const xLiveDestination: DestinationAdapter = {
  id: "x",
  displayName: "X",
  capabilities: { maxLength: 280, media: true, links: true, threads: true },
  async publish(post) {
    const live = !!process.env.X_API_CLIENT_ID;
    if (live && process.env.ENABLE_X_WRITE !== "true") {
      // the flag guards REAL writes: with credentials present and the flag
      // off, throw loudly (never no-op — the Neynar write convention).
      // Fixture mode has no credentials and nothing to protect; the fixture
      // lifecycle runs so the contract is testable without spending.
      throw new Error(
        "X write disabled (ENABLE_X_WRITE is not true) — refusing to publish, not silently dropping"
      );
    }
    if (live) {
      // live path (unreached this pass): POST /2/tweets with the caller's
      // idempotency handled a level up in the spend ledger
      throw new Error("live X publish requires the Gate 3 live-write test context");
    }
    return withMockLatency(
      () => {
        lastReceived.set("x", post);
        return { externalRef: `x:post:live:${Date.now().toString(36)}:${++refSeq}` };
      },
      { label: "destination.x_live.publish" }
    );
  },
  async costEstimate(post) {
    return withMockLatency(
      () => {
        let amount = post.links.length > 0 ? rateCard.postWithLink : rateCard.postBase;
        if (post.hasMedia) amount += rateCard.mediaSurcharge;
        return { amount: Math.round(amount * 1000) / 1000, currency: rateCard.currency };
      },
      { label: "destination.x_live.cost" }
    );
  },
};

/** Rate-card provenance for the composer tooltip. */
export function xRateCardMeta(): { lastVerified: string } {
  return { lastVerified: rateCard.lastVerified };
}

export const DESTINATIONS: Record<string, DestinationAdapter> = {
  [xMockDestination.id]: xMockDestination,
  [tiktokMockDestination.id]: tiktokMockDestination,
  [xLiveDestination.id]: xLiveDestination,
};

// -------------------------------------------------------- persona binding

import { SEED_PERSONAS, state, persistNs } from "../adapters/mock/store";
import { followsIncludeSync } from "../x/follows";
import { xRigFixturesAvailable } from "../x/attestations";

/**
 * A destination binds to the persona carrying its account attestation (mock
 * attestations for now). The composer offers ONLY the active persona's
 * bound destinations — switching persona switches the list. No lock beyond
 * that: what gets posted where is the user's call.
 */
export function boundDestinationsFor(personaId: string): DestinationAdapter[] {
  const ids = state().destinationBindings.get(personaId) ?? [];
  return ids
    .filter((id) => id !== xLiveDestination.id || xDestinationOffered())
    .map((id) => DESTINATIONS[id])
    .filter(Boolean);
}

/**
 * PERSONA LAUNCH P2 (BYX G0, the honesty gate): the "X" destination publishes through a FIXTURE lifecycle (live X
 * writes are not built), so it is offered on the rig only — a rig SERVER, never the owner service (rig-shaped, but its
 * posts are the owner's real ones: a fixture "posted to X" there would claim a post that never left) nor the empty
 * world (review W1-R5; the one predicate, lib/x/attestations.ts). Off the rig an attestation may still bind it in
 * state — this listing is what every surface reads (the composer's GET, the publish route's binding check, act-as), so
 * an unlisted destination can neither be shown nor posted to.
 */
export function xDestinationOffered(): boolean {
  return xRigFixturesAvailable();
}

/** Seeded bindings: the main viewer persona holds both mock account
 * attestations; the private persona holds none (private personas have no
 * external accounts by construction); the alt holds TikTok only. */
export function seedDestinationBindings(): number {
  const s = state();
  if (s.destinationBindings.size > 0) return 0;
  const byHandle = (h: string) => SEED_PERSONAS.find((p) => p.handle === h)?.id;
  const main = byHandle("yeak__");
  const alt = byHandle("backyard_scope");
  let n = 0;
  if (main) {
    s.destinationBindings.set(main, ["x_mock", "tiktok_mock"]);
    n++;
  }
  if (alt) {
    // the PRIVATE persona binds nothing — an external account attestation on
    // a private persona would be a linkage leak waiting to happen
    s.destinationBindings.set(alt, []);
    n++;
  }
  return n;
}

export async function persistBindings(): Promise<void> {
  await persistNs("destinationBindings");
}

// ------------------------------------------------------------- overlap

/** Mock mutual-overlap: which seeded viewers also follow the author on a
 * given destination. Drives the probably-seen collapse. Static mock data —
 * the interop pass replaces this with real audience-overlap estimation. */
const OVERLAP: Record<string, string[]> = {};

export function seedOverlap(): void {
  if (Object.keys(OVERLAP).length) return;
  const byHandle = (h: string) => SEED_PERSONAS.find((p) => p.handle === h)?.id;
  const crust = byHandle("crustcritic");
  if (crust) OVERLAP["x_mock"] = [crust];
  OVERLAP["tiktok_mock"] = [];
}

export function viewerOverlaps(
  destinationId: string,
  viewerPersonaId: string,
  authorPersonaId?: string
): boolean {
  // REAL overlap where the following import provides it (X interop Gate 3):
  // the viewer's imported X following list contains the author's attested
  // account → they followed the author on X → probably seen there. Hashed
  // ids on both sides — the comparison never touches plaintext.
  if (destinationId === "x" && authorPersonaId) {
    const attestation = [...state().xAttestations.values()].find(
      (a) => a.personaId === authorPersonaId
    );
    if (attestation) {
      const hashed = createHash("sha256")
        .update("x-follow:" + attestation.platformUserId)
        .digest("hex");
      if (state().xMigrationSource.has(viewerPersonaId + ":" + hashed)) return true;
      // PERSONA LAUNCH P2 (BYX G3): an archive import keeps the follow list in the sealed xFollows document (raw ids
      // inside the seal, D-X-IDS-SEALED-NOT-HASHED) — read from this process's cache, never fetched here
      if (followsIncludeSync(viewerPersonaId, attestation.platformUserId)) return true;
    }
  }
  seedOverlap();
  return (OVERLAP[destinationId] ?? []).includes(viewerPersonaId);
}
