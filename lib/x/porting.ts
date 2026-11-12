import "server-only";
// MEGA PASS 2 Gate 6 — RELATIONSHIP PORTING ON X (extends alt-linking).
//
// Alt-linking (UX pass, Call Option A) proved "this alt is me" to one
// audience member with a self-claim grant. This carries a GRANT instead of
// a self-claim: graduate a relationship from the persona a counterpart
// already knows (say, main) to another of your own (an alt). Two halves:
//
//   1. THE REAL DISCLOSURE — an in-app linkage grant from→to, whitelisted
//      to the counterpart's persona. Their Totem client resolves it and
//      renders the merged identity. If they are not on Totem yet, the
//      grant WAITS (a pending port, sealed in the vault) and resolves the
//      moment a persona attests their X handle — the onboarding hook.
//   2. THE DENIABLE SIGNAL ON X — the same synchronized-like breadcrumb
//      alt-linking already schedules: a like on a deep old post of the
//      counterpart's from both of your X accounts, 3–12 s apart, under the
//      same daily cap and the same disclaimer. Fixture only: nothing is
//      sent to X by this pass.
//
// Reuses: grants, the alt-link scheduler's constants and gates, the rate
// limit, the disclaimer. No new crypto. Both X accounts must be linked to
// this root (asserted); private personas are excluded (asserted).
import { randomBytes } from "@/lib/platform/crypto";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { SEED_VIEWER, personaById } from "@/lib/adapters/mock/store";
import { getPersona as keystorePersona, ownPersonaIds } from "@/lib/identity/keystore";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import { ALT_LINK_DAILY_CAP, ALT_LINK_MAX_DELAY_MS, ALT_LINK_MIN_DELAY_MS, AltLinkRefusal, altHandlesFor, dailyRemaining, hasAckedDisclaimer } from "./altlink";
import { attestationByHandle, attestationFor, canonicalHandle } from "./attestations";

export const VAULT_NS = "relationshipPorts";

export interface RelationshipPort {
  id: string;
  /** the persona the counterpart already knows */
  fromPersona: string;
  /** the persona they are being graduated to */
  toPersona: string;
  counterpart: { personaId: string | null; handle: string | null };
  /** the two X handles the breadcrumb comes from — both this root's */
  handles: [string, string];
  targetPostId: string;
  delayMs: number;
  likedAt: [number, number];
  grantId: string | null;
  /**
   * POST-DEPLOY Gate 0 — a pending port no longer becomes a grant on its own.
   *   pending               waiting for someone to prove the handle it names
   *   awaiting-confirmation someone proved it; the ISSUER must now say yes, and until they do nothing is disclosed
   *   issued / declined / expired  the three ways it ends
   * The 30-day lapse (attack-mega-3 F2) was a stopgap for exactly this: it bounded how long a handle could be
   * trusted, because the handle alone was the whole authorisation. Now the handle only earns an offer.
   */
  status: "issued" | "pending" | "awaiting-confirmation" | "declined" | "expired";
  /** when a counterpart proved the handle and the offer went to the issuer */
  matchedAt?: number | null;
  createdAt: number;
  /** attack-mega-3 F2: a pending port lapses — the handle it names is not a standing offer forever */
  expiresAt: number | null;
  resolvedAt: number | null;
}
export const PENDING_PORT_TTL_MS = 30 * 24 * 3600_000;

interface Doc {
  ports: RelationshipPort[];
  loaded: boolean;
}
const g = globalThis as unknown as { __layersPorts?: Doc };

async function load(): Promise<Doc> {
  if (g.__layersPorts) return g.__layersPorts;
  let doc: Doc = { ports: [], loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) { doc.loaded = true; break; }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries);
        const rec = plain["_"] as { m?: { ports?: RelationshipPort[] } } | undefined;
        // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
        // namespace whose records are all unreadable — deleted, truncated, plaintext, or
        // sealed under a different key — became an EMPTY document marked loaded, and the next
        // write sealed that emptiness over the real record. Records present with none readable
        // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
        if (!rec)
          throw new Error(
            "vault: relationshipPorts holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        doc = { ports: Array.isArray(rec?.m?.ports) ? rec!.m!.ports! : [], loaded: true };
      } else {
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!doc.loaded) throw new Error("relationship ports unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty");
  g.__layersPorts = doc;
  return doc;
}
async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new Error("relationship ports were never loaded — refusing to seal over them");
  g.__layersPorts = doc;
  const inner = JSON.stringify(doc.ports);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  await flushVault(VAULT_NS, encryptNamespace(VAULT_NS, { _: { m: { ports: doc.ports }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } }));
}
export function resetPortsCache(): void {
  g.__layersPorts = undefined;
}

const ownIds = () => new Set([...SEED_VIEWER.personas, ...ownPersonaIds()]);
const personaExists = (id: string) => personaById.has(id) || !!keystorePersona(id);

function portsToday(personaId: string, ports: RelationshipPort[]): number {
  const dayStart = Date.now() - 24 * 3600_000;
  return ports.filter((p) => p.fromPersona === personaId && p.createdAt >= dayStart).length;
}

export interface PortInput {
  fromPersona: string;
  toPersona: string;
  counterpart: { personaId?: string; handle?: string };
  targetPostId: string;
}

/** issue (or queue) a relationship port; every refusal is typed and named */
export async function runRelationshipPort(input: PortInput): Promise<{ port: RelationshipPort; grant: unknown }> {
  const own = ownIds();
  const { fromPersona, toPersona } = input;
  if (!own.has(fromPersona) || !own.has(toPersona)) throw new AltLinkRefusal("not_own", "both personas must be your own");
  if (fromPersona === toPersona) throw new AltLinkRefusal("not_own", "porting needs two different personas of yours");
  // private personas are excluded — a private persona's linkage is never carried anywhere, by anything
  if (isPrivatePersona(toPersona) || isPrivatePersona(fromPersona)) throw new AltLinkRefusal("not_linked", "a private persona is never ported — the graduation target and the source must both be public personas");
  // both X accounts linked to THIS root: the source's attested handle, and the target's attested handle or the source's alt handle
  const primary = attestationFor(fromPersona);
  if (!primary) throw new AltLinkRefusal("not_linked", `${fromPersona} must be OAuth-linked to an X handle first`);
  const secondary = attestationFor(toPersona)?.handle ?? altHandlesFor(fromPersona)[0] ?? null;
  if (!secondary) throw new AltLinkRefusal("no_alt_handle", "the second X account must be linked to this root too — link the target persona's handle, or an alt handle of the source");
  if (canonicalHandle(secondary) === canonicalHandle(primary.handle)) throw new AltLinkRefusal("no_alt_handle", "the two X accounts must differ");
  if (!hasAckedDisclaimer(fromPersona)) throw new AltLinkRefusal("disclaimer_required", "the risk disclaimer must be acknowledged before first use");
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(input.targetPostId)) throw new AltLinkRefusal("not_linked", "pick a post of the counterpart's to like");
  const doc = await load();
  if (dailyRemaining(fromPersona) - portsToday(fromPersona, doc.ports) <= 0) {
    throw new AltLinkRefusal("rate_limited", `daily limit reached (${ALT_LINK_DAILY_CAP} per account, alt-links and ports together) — refusing, not queueing for later`);
  }
  // the counterpart: a Totem persona, or an attested handle → its persona, or just a handle (pending)
  let counterpartId: string | null = null;
  let counterpartHandle: string | null = null;
  if (input.counterpart.personaId) {
    if (!personaExists(input.counterpart.personaId)) throw new AltLinkRefusal("not_linked", "unknown counterpart persona");
    counterpartId = input.counterpart.personaId;
    counterpartHandle = attestationFor(counterpartId)?.handle ?? null;
  } else if (input.counterpart.handle) {
    counterpartHandle = canonicalHandle(input.counterpart.handle);
    if (!/^[a-z0-9_]{1,15}$/.test(counterpartHandle)) throw new AltLinkRefusal("not_linked", "counterpart handle malformed");
    counterpartId = attestationByHandle(counterpartHandle)?.personaId ?? null;
  } else {
    throw new AltLinkRefusal("not_linked", "name a counterpart — a Totem persona or an X handle");
  }
  if (counterpartId && own.has(counterpartId)) throw new AltLinkRefusal("not_own", "the counterpart must be someone else");

  // THE REAL DISCLOSURE, issued before anything else when the counterpart is here; queued otherwise
  let grant: unknown = null;
  if (counterpartId) {
    grant = await retryAdapter(() => adapters.identity.issueGrant({ fromPersona, toPersona, audienceMember: counterpartId!, tier: "whitelist" }));
  }
  const now = Date.now();
  const delayMs = ALT_LINK_MIN_DELAY_MS + (randomBytes(4).readUInt32BE(0) % (ALT_LINK_MAX_DELAY_MS - ALT_LINK_MIN_DELAY_MS));
  const port: RelationshipPort = {
    id: "port_" + randomBytes(6).toString("hex"),
    fromPersona,
    toPersona,
    counterpart: { personaId: counterpartId, handle: counterpartHandle },
    handles: [canonicalHandle(primary.handle), canonicalHandle(secondary)],
    targetPostId: input.targetPostId,
    delayMs,
    likedAt: [now, now + delayMs],
    grantId: grant ? (grant as { id: string }).id : null,
    status: grant ? "issued" : "pending",
    createdAt: now,
    expiresAt: grant ? null : now + PENDING_PORT_TTL_MS,
    resolvedAt: grant ? now : null,
  };
  doc.ports.push(port);
  await save(doc);
  return { port, grant };
}

/** the onboarding hook: when a persona attests an X handle, every port waiting on that handle resolves */
export async function resolvePendingPorts(handle: string, personaId: string): Promise<RelationshipPort[]> {
  const h = canonicalHandle(handle);
  const doc = await load();
  const resolved: RelationshipPort[] = [];
  let expired = 0;
  for (const p of doc.ports) {
    if (p.status !== "pending" || p.counterpart.handle !== h) continue;
    if (p.expiresAt !== null && p.expiresAt <= Date.now()) { p.status = "expired"; expired++; continue; } // attack-mega-3 F2
    if (ownIds().has(personaId)) continue; // one of ours linking that handle is not the counterpart arriving
    // POST-DEPLOY Gate 0: proving the handle does NOT issue the grant. It makes an OFFER the issuer must accept —
    // the handle says who may be asked, never what may be disclosed. Nothing about the two personas is revealed
    // until confirmPort() runs, and the offer lapses with the port's own window.
    p.counterpart.personaId = personaId;
    p.status = "awaiting-confirmation";
    p.matchedAt = Date.now();
    resolved.push(p);
  }
  if (resolved.length || expired) await save(doc);
  return resolved;
}

export async function listPorts(): Promise<RelationshipPort[]> {
  return [...(await load()).ports];
}

/**
 * POST-DEPLOY Gate 0 — the issuer's answer to an offer. Only the person who created the port can turn it into a
 * disclosure, and only while it is still live: an expired offer is refused rather than quietly honoured.
 * `accept: false` declines it for good, so a counterpart cannot keep the offer alive by re-proving the handle.
 */
export async function confirmPort(portId: string, accept: boolean): Promise<RelationshipPort> {
  const doc = await load();
  const p = doc.ports.find((x) => x.id === portId);
  if (!p) throw new Error("unknown port");
  if (p.status === "expired" || (p.expiresAt !== null && p.expiresAt <= Date.now())) {
    p.status = "expired";
    await save(doc);
    throw new Error("that offer has lapsed; the counterpart can prove the handle again to raise a fresh one");
  }
  if (p.status !== "awaiting-confirmation") throw new Error("this port is " + p.status + ", not awaiting confirmation");
  // GATE 5 (attack-post-1 F-5): "anyone but the issuing persona is refused" was checked
  // against the DEVICE roster, which port creation already guaranteed — so the check was a
  // tautology, and the ACTING persona was never consulted at all. Under compartment mode that
  // let the active persona answer a hidden sibling's pending offer and turn it into a real
  // disclosure grant, using a portId the port list had handed it.
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const acting = activeSeedPersonaId();
  if (acting !== p.fromPersona)
    throw new Error("only the persona that issued this port can answer it — you are acting as a different persona");
  if (!ownIds().has(p.fromPersona)) throw new Error("only the persona that issued the port can confirm it");

  // GATE 5 (attack-post-1 F-6): the status was checked and then AWAITED across. Two confirms
  // inside the issueGrant window both passed the check and issued two grants; a confirm racing
  // a decline ended "declined" with the disclosure already made. The port is CLAIMED before
  // the await, so a second caller finds it settled and is refused by the check above.
  const claimed = p.status;
  p.status = accept ? "issued" : "declined";
  try {
    await save(doc);
  } catch (e) {
    p.status = claimed;
    throw e;
  }

  if (!accept) {
    p.resolvedAt = Date.now();
    await save(doc);
    return p;
  }
  const audienceMember = p.counterpart.personaId;
  if (!audienceMember) {
    p.status = claimed;
    await save(doc);
    throw new Error("the offer names no counterpart to disclose to");
  }
  const grant = await retryAdapter(() => adapters.identity.issueGrant({ fromPersona: p.fromPersona, toPersona: p.toPersona, audienceMember, tier: "whitelist" }));
  p.grantId = (grant as { id: string }).id;
  p.resolvedAt = Date.now();
  await save(doc);
  return p;
}

export function portStatus(p: RelationshipPort): "scheduled" | "completed" | "expired" | "awaiting-confirmation" | "declined" {
  if (p.status === "expired" || ((p.status === "pending" || p.status === "awaiting-confirmation") && p.expiresAt !== null && p.expiresAt <= Date.now())) return "expired";
  if (p.status === "awaiting-confirmation") return "awaiting-confirmation";
  if (p.status === "declined") return "declined";
  return Date.now() >= p.likedAt[1] ? "completed" : "scheduled";
}
