import "server-only";
// CALL OPTION A — X ALT LINKING. Experimental, disclaimed, fixture-only.
//
// DESIGN NOTE, found the hard way (accept-calla.mjs's own setup step):
// the natural reading of "link two of your Totem personas, each attested
// to a different X handle" doesn't fit this fixture's viewer roster — it
// has exactly ONE public persona (the other is private, and private
// personas are correctly barred from ANY external attestation elsewhere
// in this codebase — a private persona linking to a public X handle is
// the exact linkage leak that rule exists to prevent). Adding a second
// public viewer persona to fix that would ripple into every act-as/
// persona-mode test that hardcodes SEED_VIEWER.personas.length === 2.
//
// So this models what the feature actually needs more precisely: ONE
// persona's regular attested X handle (from the X-interop Gate 1 flow),
// plus a SEPARATELY linked "alt handle" — a second X account the SAME
// person also controls. That's the real-world shape of "I have a main
// and a side account" anyway, and it needs no second persona at all.
//
// The REAL disclosure is still the in-app grant, issued through the SAME
// adapters.identity.issueGrant every other disclosure feature uses.
// fromPersona === toPersona here is not a workaround — the grants.ts
// module already documents this exact shape ("An audience grant sets
// fromPersona === toPersona: it is not a claim about a PAIR, it is a
// claim about one persona and one viewer") for precisely this kind of
// "I'm disclosing a fact about myself to this viewer" claim.
//
// No real setTimeout: fixture mode never hits real X (nothing to actually
// DO at t+delay), so both like timestamps are computed and recorded at
// request time; "scheduled" vs "completed" is a pure function of
// wall-clock time against those timestamps, never stored/mutable/timer
// state — nothing to lose on a restart, nothing dangling if the process
// dies mid-delay.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, personaById, SEED_VIEWER } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { attestationFor, canonicalHandle } from "@/lib/x/attestations";
import { isPrivatePersona } from "@/lib/identity/personaKind";

export const ALT_LINK_DAILY_CAP = 3;
export const ALT_LINK_MIN_DELAY_MS = 3000;
export const ALT_LINK_MAX_DELAY_MS = 12000;

export interface AltLinkAttempt {
  id: string;
  personaId: string;
  handleA: string;
  handleB: string;
  targetPostId: string;
  audienceMember: string;
  grantId: string;
  delayMs: number;
  likedAt: [number, number];
  createdAt: number;
}

export class AltLinkRefusal extends Error {
  reason: "not_own" | "not_linked" | "no_alt_handle" | "rate_limited" | "disclaimer_required";
  constructor(reason: AltLinkRefusal["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

function requireOwnLinkedPersona(personaId: string): string {
  if (!SEED_VIEWER.personas.includes(personaId)) throw new AltLinkRefusal("not_own", "not one of your personas");
  const att = attestationFor(personaId);
  if (!att || isPrivatePersona(personaId)) {
    throw new AltLinkRefusal("not_linked", "this persona must be OAuth-linked to an X handle first");
  }
  return att.handle;
}

/** Alt handles this persona has separately linked (fixture-mode "OAuth"
 * for a second account, same fixture-one-shot shape as /api/x/link). */
export function altHandlesFor(personaId: string): string[] {
  return state().altXHandles.get(personaId) ?? [];
}

export async function linkAltHandle(personaId: string, rawHandle: string): Promise<string[]> {
  const primary = requireOwnLinkedPersona(personaId);
  const handle = canonicalHandle(rawHandle);
  if (!handle) throw new Error("handle required");
  if (handle === primary) throw new Error("that's already this persona's primary linked handle");
  const s = state();
  const existing = s.altXHandles.get(personaId) ?? [];
  if (!existing.includes(handle)) {
    s.altXHandles.set(personaId, [...existing, handle]);
    await persistNs("altXHandles");
  }
  return s.altXHandles.get(personaId)!;
}

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function attemptsToday(personaId: string): AltLinkAttempt[] {
  const start = todayStartMs();
  return state().altLinkAttempts.filter((a) => a.createdAt >= start && a.personaId === personaId);
}

export function dailyRemaining(personaId: string): number {
  return Math.max(0, ALT_LINK_DAILY_CAP - attemptsToday(personaId).length);
}

export function hasAckedDisclaimer(personaId: string): boolean {
  return state().altLinkDisclaimerAcked.has(personaId);
}

export async function ackDisclaimer(personaId: string): Promise<void> {
  state().altLinkDisclaimerAcked.add(personaId);
  await persistNs("altLinkDisclaimerAcked");
}

export interface AltLinkStatus {
  personaId: string;
  handle: string;
  name: string;
  primaryHandle: string;
  altHandles: string[];
}

export function altLinkStatusFor(personaId: string): AltLinkStatus | null {
  const p = personaById.get(personaId);
  const att = attestationFor(personaId);
  if (!p || !att || isPrivatePersona(personaId)) return null;
  return { personaId, handle: p.handle, name: p.name, primaryHandle: att.handle, altHandles: altHandlesFor(personaId) };
}

/**
 * Run one alt-link. Refuses loudly (never queues, never partially runs) on:
 * an unowned/unlinked persona, no linked alt handle, a disclaimer not yet
 * acknowledged, or the persona already at today's cap. On success: issues
 * the real disclosure grant FIRST, then records the two-like schedule — a
 * caller who only checks "did the grant land" gets the correct, complete
 * answer either way.
 */
export async function runAltLink(input: {
  personaId: string;
  altHandle: string;
  targetPostId: string;
  audienceMember: string;
}): Promise<{ attempt: AltLinkAttempt; grant: unknown }> {
  const { personaId, targetPostId, audienceMember } = input;
  const primaryHandle = requireOwnLinkedPersona(personaId);
  const altHandle = canonicalHandle(input.altHandle);
  if (!altHandlesFor(personaId).includes(altHandle)) {
    throw new AltLinkRefusal("no_alt_handle", "link that alt handle first");
  }
  if (!hasAckedDisclaimer(personaId)) {
    throw new AltLinkRefusal("disclaimer_required", "the risk disclaimer must be acknowledged before first use");
  }
  if (dailyRemaining(personaId) <= 0) {
    throw new AltLinkRefusal(
      "rate_limited",
      `daily limit reached (${ALT_LINK_DAILY_CAP} per account) — refusing, not queueing for later`
    );
  }

  // THE REAL DISCLOSURE. Issued before anything else — see the module
  // comment for why fromPersona === toPersona is the correct shape here,
  // not a workaround.
  const grant = await retryAdapter(() =>
    adapters.identity.issueGrant({
      fromPersona: personaId,
      toPersona: personaId,
      audienceMember,
      tier: "whitelist",
    })
  );

  const now = Date.now();
  const delayMs = ALT_LINK_MIN_DELAY_MS + Math.floor(Math.random() * (ALT_LINK_MAX_DELAY_MS - ALT_LINK_MIN_DELAY_MS));
  const attempt: AltLinkAttempt = {
    id: "altlink_" + createHash("sha256").update(personaId + altHandle + targetPostId + now).digest("hex").slice(0, 12),
    personaId,
    handleA: primaryHandle,
    handleB: altHandle,
    targetPostId,
    audienceMember,
    grantId: (grant as { id: string }).id,
    delayMs,
    likedAt: [now, now + delayMs],
    createdAt: now,
  };
  state().altLinkAttempts.push(attempt);
  await persistNs("altLinkAttempts");
  return { attempt, grant };
}

export function attemptStatus(a: AltLinkAttempt): "scheduled" | "completed" {
  return Date.now() >= a.likedAt[1] ? "completed" : "scheduled";
}
