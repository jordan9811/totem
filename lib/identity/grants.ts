import "server-only";
// The grant is the atom. Every disclosure feature reduces to pairwise
// persona claims — there is no visibility level on a persona.
//
// Tiers are expressed IN THE DATA, not as an enum on an identity:
//   public    → one grant, audienceMember "*"
//   opt_in    → one grant, audienceMember "*", resolution requires a request
//   whitelist → N grants, one per named audienceMember
//   hidden    → NO GRANT EXISTS. Absence of a row, not a flag.
import { createHash } from "@/lib/platform/crypto";
import { verifyCanonical } from "@/lib/crypto/ed25519";

export type GrantTier = "public" | "opt_in" | "whitelist";

/** Wildcard audience. Still a pairwise claim; the audience is just open. */
export const OPEN_AUDIENCE = "*";

/**
 * What a grant CLAIMS. Both kinds are pairwise, signed, and audience-scoped,
 * so they share this table — but they say different things and must never be
 * resolved by the same code path:
 *
 *   linkage  — "these two personas are the same person, right now"
 *   forward  — "this persona moved to that one"
 *   audience — "this viewer may see this persona's private posts"
 *
 * An audience grant sets fromPersona === toPersona: it is not a claim about a
 * PAIR, it is a claim about one persona and one viewer. Reusing the row shape
 * keeps issue/revoke/expiry identical for all three, which is the point — an
 * audience is revoked by exactly the same code path as a linkage.
 *
 * Conflating them merges a fork's old and new persona into one displayed
 * identity, which is both wrong (they are not simultaneous) and destructive
 * (the forward pointer crowds out the real sibling). Caught by Gate 2.
 */
export type GrantKind = "linkage" | "forward" | "audience";

export interface Grant {
  id: string;
  fromPersona: string;
  toPersona: string;
  audienceMember: string;
  tier: GrantTier;
  /** absent on grants written before forking existed — those are linkages */
  kind?: GrantKind;
  issuedAt: number;
  revokedAt: number | null;
  signature: string;
}

/** Default-safe: an unmarked grant is a linkage, which is what all seeds are. */
export function grantKind(g: Grant): GrantKind {
  return g.kind ?? "linkage";
}

export interface ResolutionRequest {
  id: string;
  /** the persona pair whose linkage was asked about */
  fromPersona: string;
  toPersona: string;
  /** who asked — recorded and shown to the owner ("who asked" list) */
  requesterPersona: string;
  requestedAt: number;
  resolved: boolean;
}

/**
 * THE CANONICAL FORM — the exact bytes a grant's signature covers. Real
 * Ed25519 since the crypto pass; the shape is unchanged from the mock
 * era because it was designed to be signed.
 *
 * `kind` is IN the canonical form, and that is load-bearing. Without it a
 * signature over "these two personas are the same person" is byte-identical
 * to one over "this persona moved to that one" — the same bytes would verify
 * as either claim, so a grant could be reinterpreted as a different assertion
 * without breaking its signature.
 *
 * `revokedAt` is in it too: the revoked state is itself a signed claim,
 * so revocation RE-SIGNS (the revoker IS the issuer — fromPersona).
 */
export function grantCanonical(g: Omit<Grant, "id" | "signature">): string {
  return [
    grantKind(g as Grant),
    g.fromPersona,
    g.toPersona,
    g.audienceMember,
    g.tier,
    String(g.issuedAt),
    String(g.revokedAt ?? ""),
  ].join("|");
}

/** The row id derives from the ISSUANCE canonical (revokedAt forced
 * empty), so revoking never changes a grant's identity — references
 * held by forks, UIs and tests stay stable while the signature moves
 * with the current state. */
export function grantId(g: Omit<Grant, "id" | "signature">): string {
  const issuance = grantCanonical({ ...g, revokedAt: null });
  return "g_" + createHash("sha256").update(issuance).digest("hex").slice(0, 24);
}

/**
 * Sign a new grant. The signer is a CLOSURE (persona key resolution
 * lives in lib/identity/keys.ts — this module stays pure of key
 * storage, which also keeps it import-cycle-free). The signing rule is
 * fixed here: THE ISSUER IS fromPersona, so callers pass
 * `(c) => signForPersona(g.fromPersona, c)`.
 *
 * Returns null when the signer cannot sign (persona not ours, not
 * seeded) — the caller must REFUSE issuance, never store unsigned.
 */
export function signGrantWith(
  g: Omit<Grant, "id" | "signature">,
  signer: (canonical: string) => string | null
): { id: string; signature: string } | null {
  const signature = signer(grantCanonical(g));
  if (signature === null) return null;
  return { id: grantId(g), signature };
}

/** Re-sign an existing grant after a field change (revocation). Same
 * id — identity is the issuance canonical — fresh signature over the
 * CURRENT canonical. Null if the signer refuses. */
export function resignGrant(g: Grant, signer: (canonical: string) => string | null): Grant | null {
  const signature = signer(grantCanonical(g));
  if (signature === null) return null;
  return { ...g, signature };
}

/** Pure verification against a resolved public key. Key RESOLUTION
 * (which key speaks for fromPersona) is the caller's job via
 * lib/identity/keys.ts / lib/identity/verifiedGrants.ts. */
export function verifyGrantSig(g: Grant, publicKeyHex: string): boolean {
  return verifyCanonical(g.signature, grantCanonical(g), publicKeyHex);
}

export function isLive(g: Grant, now = Date.now()): boolean {
  return g.revokedAt === null || g.revokedAt > now;
}

/**
 * THE resolution predicate. "May `viewer` learn that `from` and `to` are the
 * same person?" This is the exact check the real track must prove in a
 * circuit without revealing the grant set.
 *
 * Returns the tier that authorised it, or null. Opt-in only resolves when a
 * matching request has been made and recorded — the link exists but does not
 * resolve on sight.
 */
export function resolveLinkage(
  grants: Grant[],
  requests: ResolutionRequest[],
  from: string,
  to: string,
  viewer: string | null,
  now = Date.now()
): { tier: GrantTier; grant: Grant } | null {
  const pairMatches = (g: Grant) =>
    (g.fromPersona === from && g.toPersona === to) ||
    (g.fromPersona === to && g.toPersona === from);

  const live = grants.filter(
    (g) => grantKind(g) === "linkage" && pairMatches(g) && isLive(g, now)
  );
  if (live.length === 0) return null; // hidden: absence, not a flag

  // Whitelist: a grant naming this viewer specifically.
  if (viewer) {
    const named = live.find((g) => g.tier === "whitelist" && g.audienceMember === viewer);
    if (named) return { tier: "whitelist", grant: named };
  }

  const open = live.find((g) => g.audienceMember === OPEN_AUDIENCE);
  if (!open) return null;

  if (open.tier === "public") return { tier: "public", grant: open };

  if (open.tier === "opt_in") {
    if (!viewer) return null;
    const asked = requests.some(
      (r) =>
        r.requesterPersona === viewer &&
        r.resolved &&
        ((r.fromPersona === from && r.toPersona === to) ||
          (r.fromPersona === to && r.toPersona === from))
    );
    return asked ? { tier: "opt_in", grant: open } : null;
  }

  return null;
}

/** Every sibling of `persona` that `viewer` is authorised to learn about. */
export function resolvableSiblings(
  grants: Grant[],
  requests: ResolutionRequest[],
  persona: string,
  viewer: string | null,
  now = Date.now()
): string[] {
  const out = new Set<string>();
  for (const g of grants) {
    if (grantKind(g) !== "linkage") continue; // a move is not a sibling
    if (!isLive(g, now)) continue;
    const other =
      g.fromPersona === persona ? g.toPersona : g.toPersona === persona ? g.fromPersona : null;
    if (!other) continue;
    if (resolveLinkage(grants, requests, persona, other, viewer, now)) out.add(other);
  }
  return [...out];
}
