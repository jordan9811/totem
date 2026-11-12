import "server-only";
// FOLLOW MIGRATION — the bridge from an imported X following list to real
// follows here, and the deferred moment when someone joins later.
//
// THE MATCHING RULE, fail-closed: matching consults ACCOUNT ATTESTATIONS
// and nothing else. The key is the HASHED platform id — the same hash the
// import stored, computed from the attestation's OAuth-verified user id. A
// handle claimed anywhere else (bio, graph claim, display name) is not an
// attestation and can never match — the adversarial test plants exactly
// that and harvests zero follows.
//
// Single-viewer shape (judgment call, logged): the follow graph delta is
// the seed viewer's — matching and migration run for the persona that
// imported the list, which in the demo is the main viewer persona.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, personaById } from "@/lib/adapters/mock/store";
import { logEdgeEvent, setFollowing, followingFor } from "@/lib/eventlog/log";
import type { AccountAttestation } from "./attestations";
import { canonicalHandle } from "./attestations";

export interface MigrationMatch {
  hashedId: string;
  matchedPersonaId: string;
  matchedHandle: string; // the LAYERS persona handle
  xHandle: string; // the attested X handle
  alreadyFollowing: boolean;
}

export interface MigrationPrefs {
  deferred: boolean;
  excludedHandles: string[]; // canonical X handles the user does not want here
}

export interface MigrationNotice {
  id: string;
  personaId: string; // recipient
  kind: "joined" | "waiting";
  text: string;
  handle: string; // subject handle for the card
  at: number;
}

const hashOf = (platformUserId: string) =>
  createHash("sha256").update("x-follow:" + platformUserId).digest("hex");

export function prefsFor(personaId: string): MigrationPrefs {
  return state().xMigrationPrefs.get(personaId) ?? { deferred: true, excludedHandles: [] };
}

export async function setPrefs(personaId: string, patch: Partial<MigrationPrefs>): Promise<MigrationPrefs> {
  const s = state();
  const next: MigrationPrefs = {
    ...prefsFor(personaId),
    ...patch,
    ...(patch.excludedHandles
      ? { excludedHandles: patch.excludedHandles.map(canonicalHandle) }
      : {}),
  };
  s.xMigrationPrefs.set(personaId, next);
  await persistNs("xMigrationPrefs");
  return next;
}

/** Pending = imported, not yet migrated, not excluded. */
function pendingEntriesFor(personaId: string) {
  return [...state().xMigrationSource.entries()].filter(
    ([key, v]) => key.startsWith(personaId + ":") && !v.migrated && !v.excluded
  );
}

/** Match the pending list against attestations ONLY. */
export function matchesFor(personaId: string): { matches: MigrationMatch[]; pendingCount: number } {
  const s = state();
  const excluded = new Set(prefsFor(personaId).excludedHandles);
  const pending = pendingEntriesFor(personaId);
  const byHash = new Map<string, AccountAttestation>();
  for (const a of s.xAttestations.values()) byHash.set(hashOf(a.platformUserId), a);
  const following = followingFor(personaId);
  const matches: MigrationMatch[] = [];
  for (const [, entry] of pending) {
    const attestation = byHash.get(entry.hashedId);
    if (!attestation) continue;
    if (excluded.has(attestation.handle)) continue;
    matches.push({
      hashedId: entry.hashedId,
      matchedPersonaId: attestation.personaId,
      matchedHandle: personaById.get(attestation.personaId)?.handle ?? attestation.personaId,
      xHandle: attestation.handle,
      alreadyFollowing: following.has(attestation.personaId),
    });
  }
  return { matches, pendingCount: pending.length - matches.length };
}

async function executeFollow(actorPersonaId: string, match: MigrationMatch, context: string): Promise<void> {
  const s = state();
  if (!match.alreadyFollowing) {
    await setFollowing(match.matchedPersonaId, true);
    await logEdgeEvent({
      type: "follow",
      actorPersonaId,
      targetPersona: match.matchedPersonaId,
      triggeringCastId: null,
      context, // origin: "x-migration" / "x-migration-deferred"
    });
  }
  const entry = s.xMigrationSource.get(actorPersonaId + ":" + match.hashedId);
  if (entry) entry.migrated = true;
  await persistNs("xMigrationSource");
}

/** The batch: one confirm, all current matches follow, each logged with its
 * origin. Already-followed matches just clear from pending (no double edge). */
export async function migrateAll(personaId: string): Promise<{ followed: number; cleared: number }> {
  const { matches } = matchesFor(personaId);
  let followed = 0;
  let cleared = 0;
  for (const m of matches) {
    await executeFollow(personaId, m, "x-migration");
    if (m.alreadyFollowing) cleared++;
    else followed++;
  }
  return { followed, cleared };
}

function pushNotice(n: Omit<MigrationNotice, "id" | "at">): void {
  const s = state();
  const id = "xmn_" + createHash("sha256").update(n.personaId + n.kind + n.handle + ":" + s.seq++).digest("hex").slice(0, 10);
  s.xMigrationNotices.set(id, { ...n, id, at: Date.now() });
}

export function noticesFor(personaId: string): MigrationNotice[] {
  return [...state().xMigrationNotices.values()]
    .filter((n) => n.personaId === personaId)
    .sort((a, b) => b.at - a.at);
}

/**
 * THE DEFERRED MOMENT. A new attestation just landed: every persona holding
 * a pending entry for that platform id (deferred on, not excluded)
 * auto-follows, and both sides get their card through the injection queue —
 * the follower a "just joined" notice, the joiner one "N people were
 * waiting" notice.
 */
export async function onNewAttestation(attestation: AccountAttestation): Promise<number> {
  const s = state();
  const hashed = hashOf(attestation.platformUserId);
  let waiting = 0;
  for (const [key, entry] of s.xMigrationSource.entries()) {
    if (entry.hashedId !== hashed || entry.migrated || entry.excluded) continue;
    const followerPersona = key.slice(0, key.length - (":" + hashed).length);
    if (followerPersona === attestation.personaId) continue; // you cannot wait for yourself
    const prefs = prefsFor(followerPersona);
    if (!prefs.deferred) continue;
    if (prefs.excludedHandles.includes(attestation.handle)) continue;
    const joinerHandle = personaById.get(attestation.personaId)?.handle ?? attestation.personaId;
    await executeFollow(
      followerPersona,
      {
        hashedId: hashed,
        matchedPersonaId: attestation.personaId,
        matchedHandle: joinerHandle,
        xHandle: attestation.handle,
        alreadyFollowing: followingFor(followerPersona).has(attestation.personaId),
      },
      "x-migration-deferred"
    );
    pushNotice({
      personaId: followerPersona,
      kind: "joined",
      text: `@${joinerHandle} just joined — auto-followed from your X list (@${attestation.handle}).`,
      handle: joinerHandle,
    });
    waiting++;
  }
  if (waiting > 0) {
    pushNotice({
      personaId: attestation.personaId,
      kind: "waiting",
      text: `${waiting} ${waiting === 1 ? "person was" : "people were"} waiting for you — auto-followed from their X lists.`,
      handle: attestation.handle,
    });
  }
  await persistNs("xMigrationNotices");
  return waiting;
}
