import "server-only";
// ACCOUNT ATTESTATIONS — the linking layer everything downstream keys on.
//
// Rules, all fail-closed:
//   1. One persona per handle. A second persona claiming an attested handle
//      is refused, not queued.
//   2. Private personas cannot carry external account attestations — an
//      external account on a private persona is a linkage leak waiting to
//      happen (Tier B convention, enforced HERE at the adapter, not in UI).
//   3. Unlink removes the attestation and the destination binding, and
//      disables deferred matching (Gate 4 consults attestations only, so
//      removal IS the disable). Historical imports remain — they are the
//      user's data — marked "source unlinked" via the tombstone set.
//
// zkTLS upgrade path (documented, not built): `method` distinguishes
// "oauth" from a future "web-proof"; both can coexist on the same shape.
//
// PERSONA LAUNCH P2 (BYX G0 honesty, G6 badge): two more methods, and the
// label a surface prints is DERIVED from the method, never from the mere
// presence of an attestation —
//   "fixture"            the rig's recorded OAuth exchange. It proves nothing
//                        about who holds the X account: it reads "test link,
//                        not verified" everywhere and NEVER earns a verified
//                        import (lib/x/importer.ts verifiedByFor).
//   "farcaster-verified" the persona's own Farcaster account carries a
//                        Farcaster-verified X account in the keyless index
//                        (lib/x/identity.ts attestFromIndex). A later index
//                        without the row marks the attestation `staleSince`
//                        (the badge hides); it is never auto-unlinked.
import { state, persistNs } from "@/lib/adapters/mock/store";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { isEmptyWorld, isOwnerService } from "@/lib/world-flag";

export interface AccountAttestation {
  platform: "x";
  handle: string; // canonical: lowercase, no leading @
  /** the platform's numeric account id (users/me). Follow migration matches
   * on HASHED platform ids — X archives carry accountId, not handles. */
  platformUserId: string;
  personaId: string;
  verifiedAt: number;
  method: AttestationMethod;
  proofRef: string;
  /** farcaster-verified only: when Farcaster says the X account was verified on the fid (ms) — "since <date>" */
  sourceVerifiedAt?: number | null;
  /** farcaster-verified only: set when a later index no longer carries the row — the badge hides, the link stays */
  staleSince?: number | null;
}

/** PERSONA LAUNCH P2 (BYX G0/G6): how an attestation was established. "fixture" is the rig's recorded exchange. */
export type AttestationMethod = "oauth" | "web-proof" | "fixture" | "farcaster-verified";

/**
 * PERSONA LAUNCH P2 (BYX G0): the plain-words label for a method — the one place every surface takes it from.
 * A fixture link is a TEST link; only a Farcaster verification (or a real OAuth, which is not built) is "verified".
 */
export function attestationLabel(a: Pick<AccountAttestation, "method" | "staleSince"> | null | undefined): string {
  if (!a) return "not linked";
  switch (a.method) {
    case "fixture":
      return "test link, not verified";
    case "farcaster-verified":
      return a.staleSince ? "no longer verified on Farcaster" : "verified on Farcaster";
    case "oauth":
      return "verified through X";
    case "web-proof":
      return "verified by a web proof";
  }
}

/**
 * PERSONA LAUNCH P2 (BYX G0; review W1-R5) — THE RIG'S X FIXTURE CONVENIENCES, one predicate for all of them: the
 * fixture link (app/api/x/link), the fixture archive, the raw-file ingest and the chunk tamper hooks (app/api/x/import),
 * the fixture-backed "X" crosspost destination (lib/crosspost/destinations.ts) and the Totem-local follow matcher panel
 * (app/(main)/settings/import-x). A RIG server only: dev hooks on, a server process (never the browser device, whose
 * window is defined), and NOT the owner service and NOT the empty world. The owner service is rig-shaped (its Dockerfile
 * sets ZK_DEV_HOOKS=true) but holds the owner's REAL root: a test link there would put a fake X account on a real
 * persona, and the tamper hook keeps the original piece only in process memory, so a restart between tamper and restore
 * would leave the owner's real sealed shelf corrupt for good. The same line Sign in with Farcaster draws (lib/fc/siwf).
 */
export function xRigFixturesAvailable(): boolean {
  return process.env.ZK_DEV_HOOKS === "true" && typeof window === "undefined" && !isOwnerService() && !isEmptyWorld();
}

/** a link that may make an import "verified": never a fixture, never a stale Farcaster row */
export function attestationIsVerifying(a: Pick<AccountAttestation, "method" | "staleSince"> | null | undefined): boolean {
  if (!a) return false;
  if (a.method === "fixture") return false;
  if (a.method === "farcaster-verified" && a.staleSince) return false;
  return true;
}

export function canonicalHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function attestationByHandle(handle: string): AccountAttestation | null {
  return state().xAttestations.get(canonicalHandle(handle)) ?? null;
}

export function attestationFor(personaId: string): AccountAttestation | null {
  for (const a of state().xAttestations.values()) {
    if (a.personaId === personaId) return a;
  }
  return null;
}

export function isUnlinkedSource(handle: string): boolean {
  return state().xUnlinkedHandles.has(canonicalHandle(handle));
}

/** Bind the live X destination to the persona, replacing the mock binding.
 * The mock comes back on unlink — the demo shell keeps working either way. */
function bindXDestination(personaId: string, on: boolean): void {
  const s = state();
  const current = s.destinationBindings.get(personaId) ?? [];
  const without = current.filter((d) => d !== "x" && d !== "x_mock");
  s.destinationBindings.set(personaId, on ? [...without, "x"] : [...without, "x_mock"]);
}

export async function attestHandle(input: {
  personaId: string;
  handle: string;
  platformUserId: string;
  method: AccountAttestation["method"];
  proofRef: string;
  sourceVerifiedAt?: number | null;
}): Promise<AccountAttestation> {
  const handle = canonicalHandle(input.handle);
  if (!handle) throw new Error("handle required");
  if (isPrivatePersona(input.personaId))
    throw new Error("private personas cannot carry external account attestations");
  const s = state();
  const existing = s.xAttestations.get(handle);
  if (existing && existing.personaId !== input.personaId)
    throw new Error(`@${handle} is already attested to another persona`);
  const attestation: AccountAttestation = {
    platform: "x",
    handle,
    platformUserId: input.platformUserId,
    personaId: input.personaId,
    verifiedAt: Date.now(),
    method: input.method,
    proofRef: input.proofRef,
    ...(input.sourceVerifiedAt != null ? { sourceVerifiedAt: input.sourceVerifiedAt } : {}),
    staleSince: null,
  };
  const isNew = !existing;
  s.xAttestations.set(handle, attestation);
  s.xUnlinkedHandles.delete(handle); // re-linking clears the tombstone
  bindXDestination(input.personaId, true);
  await persistNs("xAttestations");
  await persistNs("destinationBindings");
  if (isNew) {
    // THE DEFERRED MOMENT (Gate 4): a fresh attestation may be what pending
    // migration entries were waiting for. Dynamic import: migration sits on
    // the event log, which must not become a static cycle through here.
    const { onNewAttestation } = await import("./migration");
    await onNewAttestation(attestation);
    // MEGA PASS 2 Gate 6: a pending relationship port waiting on this handle resolves now — the counterpart arrived
    try {
      const { resolvePendingPorts } = await import("./porting");
      await resolvePendingPorts(handle, input.personaId);
    } catch {
      /* an unreadable port record resolves nothing; the attestation stands */
    }
  }
  return attestation;
}

export async function unlinkHandle(handle: string, byPersonaId: string): Promise<void> {
  const h = canonicalHandle(handle);
  const s = state();
  const existing = s.xAttestations.get(h);
  if (!existing) throw new Error("no attestation for that handle");
  if (existing.personaId !== byPersonaId)
    throw new Error("only the attested persona can unlink its handle");
  s.xAttestations.delete(h);
  s.xUnlinkedHandles.add(h); // imports referencing this handle render "source unlinked"
  bindXDestination(byPersonaId, false);
  await persistNs("xAttestations");
  await persistNs("destinationBindings");
}

/**
 * PERSONA LAUNCH P2 (BYX G6): a later index no longer lists the persona's Farcaster-verified X account. The badge
 * hides (staleSince set); the attestation is KEPT — hide, never delete — and never auto-unlinked: a row can drop out
 * of a beta list for reasons that say nothing about the person. A row that comes back clears the mark.
 */
export async function markAttestationStale(handle: string, stale: boolean): Promise<AccountAttestation | null> {
  const h = canonicalHandle(handle);
  const s = state();
  const existing = s.xAttestations.get(h);
  if (!existing || existing.method !== "farcaster-verified") return existing ?? null;
  const next = stale ? (existing.staleSince ?? Date.now()) : null;
  if ((existing.staleSince ?? null) === next) return existing;
  existing.staleSince = next;
  await persistNs("xAttestations");
  return existing;
}
