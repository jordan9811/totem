import "server-only";
// PERSONA LAUNCH P2 (BYX G6) — "X @handle, verified on Farcaster": a persona's X account, as FARCASTER says it.
//
// A persona with its own Farcaster account (a persona fid, or the connected main) may carry a Farcaster-verified X
// account. The keyless index (validator/xindex.js, downloaded whole by lib/x/indexClient.ts) lists those
// verifications, so the device looks its OWN fid up locally — no per-fid lookup that would tell a server which
// account it is. Linking is a click (attestFromIndex), never a side effect of reading:
//   method "farcaster-verified", proofRef "fc-index:<builtAt>:fid:<fid>" — public personas only, one persona per handle
//   (lib/x/attestations.ts enforces both). This is what makes the shelf's "verified import" real: the archive's own
//   account id must equal the attested X account id (lib/x/importer.ts linkStatusFor).
// A later index without the row hides the badge (staleSince) and keeps the attestation — never auto-unlinked.
// The public preview does not offer this at all: its personas have no Farcaster accounts.
import { fetchIndex, type XIndex } from "./indexClient";
import { attestationFor, attestHandle, markAttestationStale, type AccountAttestation } from "./attestations";

export interface XIdentity {
  fid: number | null;
  x: { handle: string; platformId: string; verifiedAt: number } | null;
  index: { available: true; builtAt: string } | { available: false; reason: string };
}

/** the row for a fid: the most recently verified X account when Farcaster lists more than one */
export function identityRow(index: XIndex, fid: number): { handle: string; platformId: string; verifiedAt: number } | null {
  const rows = index.byFid.get(fid);
  if (!rows || rows.length === 0) return null;
  let best = rows[0];
  for (const i of rows) if (index.at[i] > index.at[best]) best = i;
  return { handle: index.xu[best], platformId: index.xid[best], verifiedAt: Math.round(index.at[best] * 1000) };
}

/** THROWS when the persona's fid record cannot be read (an unreadable vault is not "no account") */
export async function xIdentityFor(personaId: string, opts: { force?: boolean } = {}): Promise<XIdentity> {
  const { personaFidRecord } = await import("@/lib/fc/personaFid");
  const rec = await personaFidRecord(personaId);
  if (!rec) return { fid: null, x: null, index: { available: false, reason: "this persona has no Farcaster account" } };
  const answer = await fetchIndex({ force: opts.force });
  if (!answer.available) return { fid: rec.fid, x: null, index: { available: false, reason: answer.reason } };
  return { fid: rec.fid, x: identityRow(answer.index, rec.fid), index: { available: true, builtAt: answer.index.builtAt } };
}

/**
 * Keep a Farcaster-verified attestation honest against the index just read: the row gone (or naming another handle)
 * marks it stale (the badge hides); the row back clears the mark. Only when the index was readable — an index that
 * could not be read says nothing about the row.
 */
export async function reconcileStaleness(personaId: string, ident: XIdentity): Promise<AccountAttestation | null> {
  const a = attestationFor(personaId);
  if (!a || a.method !== "farcaster-verified" || !ident.index.available) return a;
  const present = !!ident.x && ident.x.handle.toLowerCase() === a.handle && ident.x.platformId === a.platformUserId;
  return markAttestationStale(a.handle, !present);
}

/** the click: link the persona's Farcaster-verified X account (refused for a private persona or a handle taken) */
export async function attestFromIndex(personaId: string): Promise<AccountAttestation> {
  const ident = await xIdentityFor(personaId);
  if (ident.fid === null) throw new Error("this persona has no Farcaster account, so Farcaster cannot vouch for an X account on it");
  if (!ident.index.available) throw new Error("the Farcaster list of verified X accounts isn't available on this site yet");
  if (!ident.x) throw new Error("Farcaster's list shows no verified X account for this persona's Farcaster account");
  return attestHandle({
    personaId,
    handle: ident.x.handle,
    platformUserId: ident.x.platformId,
    method: "farcaster-verified",
    proofRef: `fc-index:${ident.index.builtAt}:fid:${ident.fid}`,
    sourceVerifiedAt: ident.x.verifiedAt,
  });
}
