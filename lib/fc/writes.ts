import "server-only";
// FARCASTER WRITES — the one seam. Safety properties, in order of blast
// radius:
//
//   HARD IDENTITY RULE (absolute): only the Gate 1 throwaway FID's signer
//   may ever sign. Any request naming another fid/signer refuses; any
//   OTHER signer-shaped credential present in env refuses the whole write
//   path — a foreign credential nearby is not a convenience, it is a
//   loaded gun.
//
//   Ledger-before-network: every write opens a pending ledger entry before
//   any attempt (lib/fc/writeLedger.ts — caps live there too).
//
//   Check-before-retry: after a timeout/ambiguous failure the NEXT attempt
//   queries for the just-attempted content before sending again. "Exactly
//   one cast on the network" is an exit criterion, tested by killing the
//   transport mid-publish.
//
// Transports: fixture (deterministic in-process network sim — commit
// happens, then the response can be force-dropped, which is exactly the
// ambiguous-failure shape real networks produce) and live (Neynar managed
// signer; requires ENABLE_FC_WRITE + throwaway creds). Fixture is the
// default and the only transport sweeps ever touch.
import {
  assertFcWriteAllowed,
  contentHashOf,
  fcWrites,
  openWrite,
  priorWriteFor,
  settleWrite,
} from "./writeLedger";
import { isLiveContent, writeEnabled } from "@/lib/adapters/neynar/mode";
import { fcCustodyAddressFor, fcSignerPublicKeyFor, isKeystoreRootedPersona, isViewerPersona } from "@/lib/identity/keys";
import { consumeFcPublishDrop } from "@/lib/adapters/devControls";
import type { PersonaFidRecord } from "./personaFid";

export class FcIdentityError extends Error {
  readonly code = "FC_IDENTITY";
}

/** CONNECT MAIN — the self-link guard's refusal. An FcIdentityError, so every write door already answers it as a 403
 * and makes no network attempt after it. */
export class FcSelfLinkError extends FcIdentityError {
  readonly selfLink = true;
}

/** CONNECT MAIN review (PUB-3, PL-1) — the guard's refusal while this service does not know which account is the
 * owner's main one (no connected record, no NEYNAR_VIEWER_FID): on the real network an interaction it cannot check
 * against main is refused, never sent on a guess. An FcIdentityError like the others: nothing reaches the ledger. */
export class FcMainUnknownError extends FcIdentityError {
  readonly mainUnknown = true;
}

/** BUILD A review (PUB-2, UXC-03) — an earlier attempt of these exact words from this account ended with its outcome
 * UNKNOWN (a dropped connection, a 5xx), and the network's recent casts do not show it: re-sending could make a
 * duplicate public post, so nothing is sent. Not a "may have gone through" answer for THIS attempt — it never left. */
export class FcRetryUnconfirmedError extends Error {
  readonly code = "FC_RETRY_UNCONFIRMED";
}

/** BUILD A review (PUB-2) — check-before-retry could not ask the network about the earlier attempt: nothing was sent */
export class FcRetryCheckError extends Error {
  readonly code = "FC_RETRY_UNCHECKED";
}

/** a transport failure the network ANSWERED (Neynar said no): nothing happened, the ledger entry is settled failed */
export function isDefinitiveFailure(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { definitive?: unknown }).definitive === true;
}

/** CONNECT MAIN review (PUB-3, PL-1): the sentence for "this service does not know your main account" — the buttons'
 *  guard (app/api/actions/farcasterDelivery.ts) and this door say the same thing */
export const MAIN_UNKNOWN_SENTENCE =
  "Totem doesn't know which Farcaster account is your main one yet (NEYNAR_VIEWER_FID is not set on this service and no main account is connected), so it can't make sure this doesn't touch your main account. Set NEYNAR_VIEWER_FID to your main account's fid on the owner service (arm-owner-service.ps1 -ViewerFid <your fid>), then try again. Nothing was sent.";

/** the owner's main account as this service is configured, before (or beside) a connected record: NEYNAR_VIEWER_FID
 *  when it is set at all (unset reads fid 3's feed, which is not the owner's) */
export function configuredMainFid(): number | null {
  const raw = (process.env.NEYNAR_VIEWER_FID ?? "").trim();
  if (!/^[1-9][0-9]{0,11}$/.test(raw)) return null;
  return Number(raw);
}

/** Content identity for dedupe/check-before-retry. A reply is identified by
 * its text AND its parent: the same words under two different casts are two
 * distinct writes, and hashing text alone would let the second one be
 * "deduped" into the first and silently never posted. */
export function fcContentHash(text: string, parent?: string): string {
  return parent ? contentHashOf(`${parent}\u0000${text}`) : contentHashOf(text);
}

/** MULTI-FID PASS Gate 1: the credentials a write posts with — the throwaway (shared-fid mode, or a
 * persona without a fid) or the persona's OWN fid + signer (per-persona-fid mode) */
export interface FcCreds {
  fid: number;
  signerUuid: string;
  personaId?: string;
  /** CONNECT MAIN: the owner's connected main account is a persona posting under its OWN fid, so its creds are
   * "persona" too — the record's origin ("connected") is what sent it through its own identity branch */
  origin: "throwaway" | "persona";
}

export function throwawayCreds(): { fid: number; signerUuid: string } | null {
  const fid = Number(process.env.FC_TEST_FID ?? "");
  const signer = process.env.FC_TEST_SIGNER_UUID ?? "";
  if (!Number.isFinite(fid) || fid <= 0 || !signer) return null;
  return { fid, signerUuid: signer };
}

/**
 * The identity gate. Refuses:
 *  - any explicitly requested fid/signer that is not the throwaway
 *  - a foreign signer credential sitting in env (legacy NEYNAR_SIGNER_UUID
 *    that differs from the throwaway) — even unused, its presence means an
 *    unknown identity COULD sign, so the path stays shut
 *  - live writes with no throwaway configured at all
 */
export function assertThrowawayIdentity(requested?: {
  fid?: number;
  signerUuid?: string;
}): { fid: number; signerUuid: string } {
  const creds = throwawayCreds();
  if (!creds) {
    throw new FcIdentityError(
      "no throwaway credentials configured (FC_TEST_FID / FC_TEST_SIGNER_UUID) — Gate 1 has not produced an identity this pass may write as"
    );
  }
  if (requested?.fid !== undefined && requested.fid !== creds.fid) {
    throw new FcIdentityError(
      `refusing to write as fid ${requested.fid}: this pass may only ever write as the throwaway fid ${creds.fid}`
    );
  }
  if (requested?.signerUuid !== undefined && requested.signerUuid !== creds.signerUuid) {
    throw new FcIdentityError(
      "refusing a signer that is not the throwaway's — the identity rule is absolute"
    );
  }
  const legacy = process.env.NEYNAR_SIGNER_UUID;
  if (legacy && legacy !== creds.signerUuid) {
    throw new FcIdentityError(
      "a non-throwaway signer credential is present in the environment (NEYNAR_SIGNER_UUID) — refusing while an unknown identity could sign"
    );
  }
  return creds;
}

/**
 * MULTI-FID PASS Gate 1: THE IDENTITY RULE, EXTENDED. This pass may only ever
 * write as fids it created itself: the Pass-FC throwaway, plus the persona
 * fids in the vault map whose origin is this pass's own acquisition path
 * (fixture, or layers-fid-pass). Any other fid, any signer that is not the
 * one recorded for that fid, and any foreign signer credential merely
 * present in the environment are refused. A persona WITHOUT a fid record —
 * private (never gets one), or public before its acquisition / while a live
 * acquisition is pending — casts through the SHARED account in either mode:
 * the v0 path, attribution disclosure-gated, never under another persona's
 * fid (MULTI-FID Gate 3, D-FID-3-NO-FID-CASTS-SHARED). The record decides.
 */
export async function assertOwnFidIdentity(requested?: { fid?: number; signerUuid?: string; personaId?: string }): Promise<FcCreds> {
  const legacy = process.env.NEYNAR_SIGNER_UUID;
  const throwaway = throwawayCreds();
  if (legacy && (!throwaway || legacy !== throwaway.signerUuid)) {
    throw new FcIdentityError(
      "a non-throwaway signer credential is present in the environment (NEYNAR_SIGNER_UUID) — refusing while an unknown identity could sign"
    );
  }
  const { personaNetworkMode } = await import("./networkMode");
  const { personaFidRecord, personaOfFid } = await import("./personaFid");
  // CONNECT MAIN: "connected" is admitted too, but ONLY through connectedCreds (its keys are not derived — main's
  // custody is the owner's Farcaster app — so the derivation-equality check below could never pass for it)
  const OWN_ORIGINS = new Set(["fixture", "layers-fid-pass", "connected", "layers-launch"]);
  if (requested?.personaId) {
    const named = await personaFidRecord(requested.personaId);
    // PERSONA LAUNCH P6: a LAUNCHED account (Totem registered it for the persona; its signer is the persona's own derived
    // key, registered on it) posts only as itself, in either network mode — never through the shared account
    if (named && named.origin === "layers-launch") return launchedCreds(named, requested);
    if (named && named.origin === "connected") {
      // main posts as itself or not at all: shared-fid mode would send main's words out under the shared test account
      if (personaNetworkMode() !== "per-persona-fid")
        throw new FcIdentityError("your main account posts only as itself — PERSONA_NETWORK_MODE=shared-fid would send it through the shared account, refused");
      return connectedCreds(named, requested);
    }
  }
  // a persona named: its own fid in per-persona-fid mode
  if (requested?.personaId && personaNetworkMode() === "per-persona-fid") {
    const rec = await personaFidRecord(requested.personaId);
    if (rec && OWN_ORIGINS.has(rec.origin)) {
      // MULTI-FID Gate 5 (attack-fid-3 #4): the record must be THIS persona's by derivation, not by its strings
      const derivedPub = fcSignerPublicKeyFor(requested.personaId);
      const derivedAddr = fcCustodyAddressFor(requested.personaId);
      if (!derivedPub || !derivedAddr || rec.signer.derivedPubHex !== derivedPub || rec.custodyAddress.toLowerCase() !== derivedAddr.toLowerCase()) {
        throw new FcIdentityError("the persona's fid record does not match the keys derived for it — refusing to write under it");
      }
      if (requested.fid !== undefined && requested.fid !== rec.fid) throw new FcIdentityError(`refusing to write as fid ${requested.fid}: that persona's own fid is ${rec.fid}`);
      const uuid = rec.signer.kind === "neynar-managed" ? rec.signer.uuid : "";
      if (requested.signerUuid !== undefined && requested.signerUuid !== uuid) throw new FcIdentityError("refusing a signer that is not the one recorded for that persona's fid — the identity rule is absolute");
      return { fid: rec.fid, signerUuid: uuid, personaId: requested.personaId, origin: "persona" };
    }
    if (rec && !OWN_ORIGINS.has(rec.origin)) throw new FcIdentityError("that persona's fid record did not come from this pass's acquisition path — refused");
  }
  // a fid named without a persona: it must be one of ours
  if (requested?.fid !== undefined && (!throwaway || requested.fid !== throwaway.fid)) {
    const owner = await personaOfFid(requested.fid);
    const rec = owner ? await personaFidRecord(owner) : null;
    if (!rec || !OWN_ORIGINS.has(rec.origin)) {
      throw new FcIdentityError(`refusing to write as fid ${requested.fid}: this pass may only ever write as fids it created itself`);
    }
    if (rec.origin === "connected") {
      if (personaNetworkMode() !== "per-persona-fid") throw new FcIdentityError("your main account posts only as itself — refused under PERSONA_NETWORK_MODE=shared-fid");
      return connectedCreds(rec, { fid: requested.fid, signerUuid: requested.signerUuid });
    }
    if (rec.origin === "layers-launch") return launchedCreds(rec, { fid: requested.fid, signerUuid: requested.signerUuid });
    const uuid = rec.signer.kind === "neynar-managed" ? rec.signer.uuid : "";
    if (requested.signerUuid !== undefined && requested.signerUuid !== uuid) throw new FcIdentityError("refusing a signer that is not the one recorded for that fid — the identity rule is absolute");
    return { fid: rec.fid, signerUuid: uuid, personaId: rec.personaId, origin: "persona" };
  }
  // otherwise the throwaway, under its own rule
  const creds = assertThrowawayIdentity({ fid: requested?.fid, signerUuid: requested?.signerUuid });
  return { ...creds, origin: "throwaway" };
}

/**
 * CONNECT MAIN — the identity branch for the owner's own main account. Its custody is the owner's Farcaster app (never
 * derived, never held here), so instead of derivation equality it checks what recordConnectedFid established and
 * re-derives what can be re-derived: the persona is keystore-rooted and public, the record is flagged publicSelf and
 * still binds THIS persona's derived key, the signer is a live Neynar-managed one (a disconnect wipes it), and the
 * vault holds exactly one connected record. Any failure refuses the write; nothing falls back to another account.
 */
async function connectedCreds(rec: PersonaFidRecord, requested: { fid?: number; signerUuid?: string; personaId?: string }): Promise<FcCreds> {
  const { kindOf } = await import("@/lib/identity/personaKind");
  const { connectedRecords } = await import("./personaFid");
  if (rec.origin !== "connected" || !rec.connected || rec.connected.publicSelf !== true) throw new FcIdentityError("not a connected main-account record — refused");
  if (requested.personaId !== undefined && requested.personaId !== rec.personaId) throw new FcIdentityError("that record belongs to another persona — refused");
  if (!isKeystoreRootedPersona(rec.personaId) || kindOf(rec.personaId) !== "public")
    throw new FcIdentityError("your main account's persona must be a public persona minted on this device — refused");
  const derivedPub = fcSignerPublicKeyFor(rec.personaId);
  if (!derivedPub || rec.signer.derivedPubHex !== derivedPub) throw new FcIdentityError("the connected record does not match the persona's derived key — refusing to write under it");
  if (rec.connected.disconnectedAt)
    throw new FcIdentityError(
      rec.connected.disconnectReason === "revoked_in_app"
        ? "your main account removed Totem in the Farcaster app's connected apps — connect it again (Settings › Connect your Farcaster account) to post as it"
        : "your main account was disconnected from Totem — connect it again (Settings › Connect your Farcaster account) to post as it"
    );
  if (rec.signer.kind !== "neynar-managed" || !rec.signer.uuid) throw new FcIdentityError("your main account has no usable signer — connect it again");
  const all = await connectedRecords();
  if (all.length !== 1) throw new FcIdentityError("this vault holds more than one connected account — refusing every write as main until it is repaired");
  if (requested.fid !== undefined && requested.fid !== rec.fid) throw new FcIdentityError(`refusing to write as fid ${requested.fid}: your main account is fid ${rec.fid}`);
  if (requested.signerUuid !== undefined && requested.signerUuid !== rec.signer.uuid) throw new FcIdentityError("refusing a signer that is not the one recorded for your main account");
  return { fid: rec.fid, signerUuid: rec.signer.uuid, personaId: rec.personaId, origin: "persona" };
}

/**
 * PERSONA LAUNCH P6 — the identity branch for a LAUNCHED account (origin "layers-launch"). Its signer is the persona's
 * own derived key, registered on the account at creation (self-custody: no managed signer, no uuid), and its custody is
 * the persona's derived custody address — so the record must equal the derivation, exactly like an acquired account's.
 * Any mismatch refuses; nothing falls back to the shared account.
 */
async function launchedCreds(rec: PersonaFidRecord, requested: { fid?: number; signerUuid?: string; personaId?: string }): Promise<FcCreds> {
  if (rec.origin !== "layers-launch") throw new FcIdentityError("not a launched-account record — refused");
  if (requested.personaId !== undefined && requested.personaId !== rec.personaId) throw new FcIdentityError("that record belongs to another persona — refused");
  if (!isKeystoreRootedPersona(rec.personaId)) throw new FcIdentityError("a launched account's persona must be minted on this device — refused");
  const derivedPub = fcSignerPublicKeyFor(rec.personaId);
  const derivedAddr = fcCustodyAddressFor(rec.personaId);
  if (rec.signer.kind !== "self-custody" || !derivedPub || !derivedAddr || rec.signer.derivedPubHex !== derivedPub || rec.custodyAddress.toLowerCase() !== derivedAddr.toLowerCase())
    throw new FcIdentityError("the launched account's record does not match the keys derived for its persona — refusing to write under it");
  if (requested.fid !== undefined && requested.fid !== rec.fid) throw new FcIdentityError(`refusing to write as fid ${requested.fid}: that persona's own account is fid ${rec.fid}`);
  if (requested.signerUuid !== undefined && requested.signerUuid !== "") throw new FcIdentityError("a launched account has no managed signer — refused");
  return { fid: rec.fid, signerUuid: "", personaId: rec.personaId, origin: "persona" };
}

// ------------------------------------------------------------------------------------------- the self-link guard
//
// CONNECT MAIN — D-FID-5-NO-CLIENT-FINGERPRINT: the owner's main account and his other accounts (every persona fid, the
// shared test account, the anon account) must NEVER interact in public. A reply, like, recast, follow or @mention
// between them is a permanent, public link that no amount of onchain hygiene undoes. The guard runs at THE choke point
// (publishFcCast / reactFc / followFc), before the cap check, the ledger entry or any network attempt, in both
// directions: main acting on another own account, and any other own account acting on main.
//
// WHO IS MAIN: the "connected" record, and — CONNECT MAIN review (PUB-3, PL-1), on the real network — NEYNAR_VIEWER_FID,
// the owner service's own "your real fid" setting, which names main for the days before it is connected. On the
// SIMULATED network with no connected record the guard is inert, exactly as before (nothing reaches anyone, and a rig's
// NEYNAR_VIEWER_FID may name a feed to read, not an account of the owner's): the A-FID-SELF-GRAPH waiver for
// persona-to-persona interactions stands either way. On the REAL network with main unknown it FAILS CLOSED: a reply,
// like, recast, follow or @mention is refused (FcMainUnknownError) — it might be the link; a plain post touches no one.
// Once main is known it FAILS CLOSED too: a target whose author cannot be established — a cast no local record holds
// and no network lookup could answer, an @name the network cannot resolve — is refused, because the unknown might be
// the link. Main stays "main" after a disconnect: the guard keeps the accounts apart whether or not Totem can still
// post as main.

type AuthorClass = "main" | "own" | "stranger";

interface SelfLinkTarget {
  /** a reply's parent cast */
  parentHash?: string;
  /** a like / recast target */
  targetHash?: string;
  /** a follow target */
  targetFid?: number;
  /** a cast's text: @mentions and profile links count as interactions */
  text?: string;
  /** PERSONA LAUNCH P6: a quote-cast's target — allowed ONLY for a launched account quoting its own revealed originals */
  quoteHash?: string;
}

/** PERSONA LAUNCH P6 (D5): how many of its own revealed originals a launched account may quote */
export const LAUNCH_QUOTE_LIMIT = 10;

/**
 * PERSONA LAUNCH P6 — R9's ONE EXCEPTION, and the sibling rule. A launched account (origin "layers-launch") may touch
 * THIS device's own anonymous posts in exactly one way: QUOTE one of its OWN originals that its launch revealed (the
 * public row says attributedFid = this fid, in a reveal batch), at most LAUNCH_QUOTE_LIMIT times in all. Everything else
 * that touches one of this device's anon posts is refused — a sibling persona's anon post (any interaction would tie the
 * launched account to it), one of its own posts its launch did not reveal, an 11th quote. And a quote of anything that is
 * not one of its revealed originals is refused too (quote posts reach Farcaster through this path only). Which anon posts
 * are this device's own comes from the sealed reveal records and the launch tick's own-rows mirror of the COMPLETE public
 * list (device-local); which are revealed, from the registrar's complete read of the rows attributed to this account
 * (fix W2-LAUNCH-SELFLINK-FAILOPEN: the newest-200 list alone let an older own post through as nobody's). A list that
 * cannot be read, or a target found nowhere before this device has read the whole list once, refuses (fail closed). Any
 * other acting account quoting anything is refused.
 */
async function assertLaunchedInteraction(actingPersonaId: string | undefined, rec: PersonaFidRecord | undefined, target: SelfLinkTarget): Promise<Set<string>> {
  const anonTargets = new Set<string>();
  const launched = !!rec && rec.origin === "layers-launch";
  if (target.quoteHash && !launched) throw new FcSelfLinkError("refused: quote posts reach Farcaster only as a launched account's quotes of its own revealed anonymous posts");
  if (!launched || !rec) return anonTargets;
  const touched: Array<[string, "reply" | "like" | "quote"]> = [];
  if (target.parentHash) touched.push([target.parentHash, "reply"]);
  if (target.targetHash) touched.push([target.targetHash, "like"]);
  if (target.quoteHash) touched.push([target.quoteHash, "quote"]);
  if (!touched.length) return anonTargets;
  type Row = { hash: string; castHash: string; attributedFid: number | null; attributedBatch?: string | null };
  let rows: Row[];
  let revealedRows: Row[] = [];
  const ownAnon = new Map<string, string | null>();
  const cannotCheck = (why: string) =>
    new FcSelfLinkError(`refused: Totem could not check whether that is one of your anonymous posts (${why}) — an interaction it cannot check could tie this account to your other personas (fail closed)`);
  // the own-rows mirror of the COMPLETE public anon list (lib/launch/tick.ts keeps it, every tick, on every device), read
  // from its global WITHOUT importing the launch modules (server-only; this file ships in the public bundle)
  const mirror = (globalThis as unknown as { __layersLaunchAnonMirror?: Partial<Record<"fixture" | "live", { complete: boolean; rows: Map<string, { hash: string; castHash: string }>; byNetwork: Map<string, string> }>> }).__layersLaunchAnonMirror?.[rec.mode];
  try {
    const { validatorUrl } = await import("@/lib/ports");
    const getJson = async (url: string): Promise<{ casts?: unknown; next?: unknown }> => {
      let last = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("the validator answered " + res.status);
          const j = (await res.json()) as { casts?: unknown; next?: unknown };
          if (!Array.isArray(j.casts)) throw new Error("the anon list is malformed");
          return j;
        } catch (e) {
          last = (e as Error).message;
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
      throw new Error(last || "the anon list could not be read");
    };
    // the PUBLIC anon list's newest page (the same read every feed render makes): which recent targets are @anon's casts
    rows = (await getJson(`${validatorUrl()}/zk/anon-casts?mode=${rec.mode}`)).casts as Row[];
    // fix W2-LAUNCH-SELFLINK-FAILOPEN: EVERY row this launched account revealed (the registrar's complete, paged read
    // naming the acting account itself — the write is public under it anyway). The newest-200 list alone made an OLDER
    // own post look like nobody's, and the guard let a sibling's (or an unrevealed) post through.
    let before: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const j = await getJson(`${validatorUrl()}/registrar/anon-casts?mode=${rec.mode}&attributedFid=${rec.fid}${before ? "&before=" + encodeURIComponent(before) : ""}`);
      revealedRows.push(...(j.casts as Row[]));
      before = typeof j.next === "string" && j.next ? j.next : null;
      if (!before) break;
    }
    // this device's own anon posts and the persona each was made as: the sealed reveal records in the store's zkQueue
    // (the reading lib/zk/anon/queue.ts attributionPersonas does, inlined so the write door never pulls the proof
    // layer's transport into its bundle)
    const store = await import("@/lib/adapters/mock/store");
    await store.hydrate();
    for (const q of store.state().zkQueue.values()) {
      if (q.claimKind === "anon-attribution" && q.attribution && q.id.startsWith("zka_")) ownAnon.set(q.id.slice(4), q.attribution.personaId ?? null);
    }
  } catch (e) {
    throw cannotCheck((e as Error).message);
  }
  revealedRows = revealedRows.filter((r) => r.attributedFid === rec.fid && !!r.attributedBatch);
  for (const [hash, what] of touched) {
    // the target, from the most complete truth outward: this account's revealed rows, this device's own rows (the
    // mirror: every one of its relayed posts, by network or internal hash), then the newest public page
    const ownCastHash = mirror?.byNetwork.get(hash) ?? (mirror?.rows.has(hash) || ownAnon.has(hash) ? hash : undefined);
    const row: Row | undefined =
      revealedRows.find((r) => r.hash === hash || r.castHash === hash) ??
      (ownCastHash ? { hash: mirror?.rows.get(ownCastHash)?.hash ?? hash, castHash: ownCastHash, attributedFid: null, attributedBatch: null } : undefined) ??
      rows.find((r) => r.hash === hash || r.castHash === hash);
    // FAIL CLOSED: a target found nowhere, while this device has not finished reading the whole public list once, might be
    // one of its own OLDER anon posts — refused rather than let through as nobody's
    if (!row && !mirror?.complete) throw cannotCheck("this device hasn't finished reading the anonymous posts yet — try again in a minute");
    const poster = row ? ownAnon.get(row.castHash) : undefined;
    if (row && poster !== undefined && poster !== actingPersonaId)
      throw new FcSelfLinkError("refused: that is an anonymous post one of your OTHER personas made — touching it from this account would tie the two together publicly");
    const revealedHere = !!row && revealedRows.some((r) => r.castHash === row.castHash);
    if (what === "quote") {
      if (!revealedHere) throw new FcSelfLinkError("refused: a launched account quotes only its OWN anonymous posts that its launch revealed — that one is not");
      const { quoteCastCount } = await import("./thinRelay");
      if (quoteCastCount(rec.fid) >= LAUNCH_QUOTE_LIMIT) throw new FcSelfLinkError(`refused: a launched account quotes at most ${LAUNCH_QUOTE_LIMIT} of its revealed anonymous posts, and this one already has`);
    } else if (row && poster === actingPersonaId && !revealedHere) {
      throw new FcSelfLinkError("refused: that is one of this persona's anonymous posts its launch did not reveal — touching it from the launched account would reveal it");
    }
    // a row of the PUBLIC anon list is authored by the shared anonymous account — never main (the main-account rule below
    // need not, and on the fixture cannot, look its author up again)
    if (row) anonTargets.add(hash);
  }
  return anonTargets;
}

/** the shared test account's fname, when the owner service is told it (FC_TEST_FNAME): no record carries it, and a
 *  mention of it by main links main to Totem's own account. Never hardcoded — this file ships in the public bundle. */
function sharedAccountFname(): string | null {
  const v = (process.env.FC_TEST_FNAME ?? "").trim().toLowerCase().replace(/^@/, "");
  return v || null;
}

const AUTHOR_CACHE_MAX = 500;
const g2 = globalThis as unknown as { __layersCastAuthorCache?: Map<string, number> };
g2.__layersCastAuthorCache ??= new Map();

/** the author fid of a NETWORK cast, from Neynar (GET /v2/farcaster/cast, live only). Retried; THROWS when it cannot
 * answer — the guard turns that into a refusal, never into "probably a stranger". Cached: a cast's author never changes. */
async function liveCastAuthorFid(hash: string): Promise<number> {
  const cache = g2.__layersCastAuthorCache!;
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;
  if (!/^0x[0-9a-fA-F]{40}$/.test(hash)) throw new Error("not a Farcaster cast hash");
  const key = process.env.NEYNAR_API_KEY ?? "";
  if (!key) throw new Error("no Neynar key to look the cast up with");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(hash)}&type=hash`, { headers: { "x-api-key": key }, cache: "no-store" });
      if (res.status === 404) throw Object.assign(new Error("the cast was not found on the network"), { definitive: true });
      if (!res.ok) throw new Error("neynar answered " + res.status);
      const data = (await res.json()) as { cast?: { author?: { fid?: unknown } } };
      const fid = Number(data?.cast?.author?.fid);
      if (!Number.isInteger(fid) || fid <= 0) throw new Error("the lookup named no author");
      if (cache.size >= AUTHOR_CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(hash, fid);
      return fid;
    } catch (e) {
      last = (e as Error).message;
      if ((e as { definitive?: boolean }).definitive) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error(last || "lookup failed");
}

const NAME_FID_TTL_MS = 10 * 60 * 1000;
const g4 = globalThis as unknown as { __layersNameFidCache?: Map<string, { fid: number | null; at: number }> };
g4.__layersNameFidCache ??= new Map();

/** CONNECT MAIN review (PL-3) — the account an @name resolves to on Farcaster RIGHT NOW (Neynar GET
 * /v2/farcaster/user/by_username: the same names Neynar's cast endpoint turns into protocol mentions), so a mention is
 * judged by the account it reaches, not by the names this device happens to hold (a renamed main, the shared test
 * account's fname, the anon account's name). Retried, cached ten minutes. null = no account has that name (nothing for
 * a mention to reach); THROWS when it cannot be read — the guard refuses then, never "probably a stranger". */
async function liveFidOfName(name: string): Promise<number | null> {
  const cache = g4.__layersNameFidCache!;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < NAME_FID_TTL_MS) return hit.fid;
  const remember = (fid: number | null) => {
    if (cache.size >= AUTHOR_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(name, { fid, at: Date.now() });
    return fid;
  };
  const key = process.env.NEYNAR_API_KEY ?? "";
  if (!key) throw new Error("no Neynar key to look the name up with");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(name)}`, { headers: { "x-api-key": key }, cache: "no-store" });
      // 404: no such account; 400: not a username at all — either way no mention can reach anyone through it
      if (res.status === 404 || res.status === 400) return remember(null);
      if (!res.ok) throw new Error("neynar answered " + res.status);
      const data = (await res.json()) as { user?: { fid?: unknown } };
      const fid = Number(data?.user?.fid);
      if (!Number.isInteger(fid) || fid <= 0) throw new Error("the lookup named no account");
      return remember(fid);
    } catch (e) {
      last = (e as Error).message;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error(last || "lookup failed");
}

/** where a cast came from, from the most local truth outward: this device's attribution index, its own ledgered sends,
 * the fixture sim network, the seed / local / fixture stores, and only then (live) the network. null = nobody knows. */
async function castAuthor(hash: string, mode: "fixture" | "live"): Promise<{ personaId?: string; fid?: number; shared?: boolean } | null> {
  const store = await import("@/lib/adapters/mock/store");
  await store.hydrate();
  const attributed = store.state().fcAttribution.get(hash);
  if (attributed?.personaId) return { personaId: attributed.personaId };
  const sent = fcWrites().find((e) => (e.kind === "cast" || e.kind === "reply") && e.castHash === hash && e.status !== "failed" && e.status !== "refused");
  if (sent) return sent.fid !== null ? { fid: sent.fid } : { shared: true };
  const sim = [...g.__layersFcSim!.values()].find((c) => c.hash === hash);
  if (sim) return sim.fid !== undefined ? { fid: sim.fid } : { shared: true };
  const seed = store.postByHash.get(hash);
  if (seed) return { personaId: seed.authorPersonaId };
  const { findLocalCast } = await import("@/lib/data");
  const local = findLocalCast(hash);
  if (local?.personaId) return { personaId: local.personaId };
  const raw = (await import("@/lib/fixtures/data.json")).default as unknown as {
    casts?: FixtureCast[];
    selfCasts?: FixtureCast[];
    threads?: Record<string, FixtureCast[]>;
  };
  const fixtureFid = fixtureAuthorFid(raw, hash);
  if (fixtureFid !== null) return { fid: fixtureFid };
  if (mode === "live") return { fid: await liveCastAuthorFid(hash) };
  return null;
}

type FixtureCast = { hash?: string; authorFid?: number; embeds?: { type?: string; quote?: FixtureCast }[] };
function fixtureAuthorFid(raw: { casts?: FixtureCast[]; selfCasts?: FixtureCast[]; threads?: Record<string, FixtureCast[]> }, hash: string): number | null {
  const walk = (c: FixtureCast | undefined): number | null => {
    if (!c) return null;
    if (c.hash === hash && typeof c.authorFid === "number") return c.authorFid;
    for (const e of c.embeds ?? []) {
      const q = e && e.type === "quote" ? walk(e.quote) : null;
      if (q !== null) return q;
    }
    return null;
  };
  for (const c of [...(raw.casts ?? []), ...(raw.selfCasts ?? []), ...Object.values(raw.threads ?? {}).flat()]) {
    const f = walk(c);
    if (f !== null) return f;
  }
  return null;
}

/** @names and profile links in a cast's text: an @mention or a link to an account is an interaction with it */
function mentionedAccounts(text: string): { names: Set<string>; fids: Set<number> } {
  const names = new Set<string>();
  const fids = new Set<number>();
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9][A-Za-z0-9-]{0,62}(?:\.eth)?)(?![A-Za-z0-9_-])/g)) names.add(m[2].toLowerCase());
  for (const m of text.matchAll(/(?:farcaster\.xyz|warpcast\.com)\/(?!~\/)@?([A-Za-z0-9][A-Za-z0-9.-]{0,40})/gi)) names.add(m[1].toLowerCase().replace(/\.+$/, ""));
  for (const m of text.matchAll(/(?:farcaster\.xyz|warpcast\.com)\/~\/profiles\/([0-9]{1,12})/gi)) fids.add(Number(m[1]));
  return { names, fids };
}

/**
 * THE GUARD. Throws FcSelfLinkError when the acting account and the target are main and another own account (either
 * direction); returns quietly otherwise. `actingPersonaId` undefined is the shared account (a persona without a fid
 * posts through it), which is never main.
 */
export async function assertNoSelfLink(actingPersonaId: string | undefined, target: SelfLinkTarget, mode: "fixture" | "live"): Promise<void> {
  const { allPersonaFids, ownAccountFidsWithAnon } = await import("./personaFid");
  const records = await allPersonaFids(); // an unreadable vault throws here: no write proceeds unguarded
  // PERSONA LAUNCH P6: the launched account's one exception and the sibling rule — before the main-account rule's early
  // return (it applies with or without a connected main)
  const anonTargets = await assertLaunchedInteraction(actingPersonaId, actingPersonaId ? records.find((r) => r.personaId === actingPersonaId) : undefined, target);
  const mains = records.filter((r) => r.origin === "connected");
  const mainIds = new Set(mains.map((r) => r.personaId));
  const mainFids = new Set(mains.map((r) => r.fid));
  // PUB-3 / PL-1: before main is connected, the owner service names it in NEYNAR_VIEWER_FID — the same fact the
  // buttons' guard reads. The real network only (see the header).
  if (mode === "live") {
    const configured = configuredMainFid();
    if (configured !== null) mainFids.add(configured);
  }
  const mentions = target.text ? mentionedAccounts(target.text) : { names: new Set<string>(), fids: new Set<number>() };
  const interacts = target.targetFid !== undefined || !!target.parentHash || !!target.targetHash || !!target.quoteHash || mentions.names.size > 0 || mentions.fids.size > 0;
  if (mainFids.size === 0) {
    if (mode === "live" && interacts) throw new FcMainUnknownError("refused: " + MAIN_UNKNOWN_SENTENCE);
    return;
  }
  const actorIsMain = !!actingPersonaId && mainIds.has(actingPersonaId);
  const refuseAs = (what: string, cls: AuthorClass | "unknown"): never => {
    if (cls === "unknown")
      throw new FcSelfLinkError(
        `refused: Totem could not establish whose ${what} that is, and an interaction it cannot check could link your main account to one of your other accounts — try again (fail closed)`
      );
    throw new FcSelfLinkError(
      actorIsMain
        ? `refused: your main account must never interact with one of your other accounts (${what}) — a reply, like, recast, follow or mention between them is a permanent public link`
        : `refused: your other accounts must never interact with your main account (${what}) — a reply, like, recast, follow or mention between them is a permanent public link`
    );
  };
  // what the far side may not be: every other own account when main acts, main when anyone else acts
  const forbidden = (cls: AuthorClass) => (actorIsMain ? cls === "own" : cls === "main");
  // main acting needs every other own account, the anonymous account included (PUB-8, PL-2) — read once, and an
  // anonymous account this app cannot name yet is refused like any other unknown
  let ownFids: Set<number> | null = null;
  const own = async (): Promise<Set<number>> => {
    if (ownFids) return ownFids;
    try {
      ownFids = await ownAccountFidsWithAnon(records);
    } catch (e) {
      throw new FcSelfLinkError(`refused: ${(e as Error).message} — an interaction Totem cannot check could link your main account to one of your other accounts (fail closed)`);
    }
    return ownFids;
  };
  const classOfFid = async (fid: number): Promise<AuthorClass> => (mainFids.has(fid) ? "main" : actorIsMain && (await own()).has(fid) ? "own" : "stranger");
  const classOfPersona = (personaId: string): AuthorClass => (mainIds.has(personaId) ? "main" : isViewerPersona(personaId) ? "own" : "stranger");

  if (target.targetFid !== undefined) {
    const cls = await classOfFid(target.targetFid);
    if (forbidden(cls)) refuseAs("a follow of fid " + target.targetFid, cls);
  }
  for (const [hash, what] of [
    [target.parentHash, "a reply"],
    [target.targetHash, "a like or recast"],
    [target.quoteHash, "a quote"],
  ] as const) {
    if (!hash) continue;
    if (anonTargets.has(hash)) continue; // PERSONA LAUNCH P6: checked above — the anonymous account's own cast, not main's
    let author: Awaited<ReturnType<typeof castAuthor>>;
    try {
      author = await castAuthor(hash, mode);
    } catch {
      author = null; // the lookup itself failed: unknown, refused below
    }
    if (!author) refuseAs(what + "'s target cast", "unknown");
    const cls: AuthorClass = author!.personaId !== undefined ? classOfPersona(author!.personaId) : author!.shared ? "own" : await classOfFid(author!.fid as number);
    if (forbidden(cls)) refuseAs(what + " on that cast", cls);
  }
  if (target.text) {
    const { names, fids } = mentions;
    const mainNames = new Set(mains.map((r) => (r.fname ?? "").toLowerCase()).filter(Boolean));
    const ownNames = new Set(records.filter((r) => r.origin !== "connected").map((r) => (r.fname ?? "").toLowerCase()).filter(Boolean));
    const shared = sharedAccountFname();
    if (shared) ownNames.add(shared);
    for (const n of names) {
      // the names this device holds first (no network); then, on the real network, the account the name reaches now
      let cls: AuthorClass = mainNames.has(n) ? "main" : ownNames.has(n) ? "own" : "stranger";
      if (cls === "stranger" && mode === "live") {
        let fid: number | null;
        try {
          fid = await liveFidOfName(n);
        } catch {
          return refuseAs("a mention of @" + n + " (the name could not be looked up)", "unknown");
        }
        if (fid !== null) cls = await classOfFid(fid);
      }
      if (forbidden(cls)) refuseAs("a mention of @" + n, cls);
    }
    for (const fid of fids) {
      const cls = await classOfFid(fid);
      if (forbidden(cls)) refuseAs("a link to fid " + fid, cls);
    }
  }
}

// ------------------------------------------------------------- transports

/** Fixture network sim: the "remote" state a publish commits to. Commit
 * precedes response, so a dropped response leaves a committed cast the
 * retry must FIND rather than duplicate — the real ambiguity, simulated. */
interface SimCast {
  hash: string;
  text: string;
  contentHash: string;
  at: number;
  /** MULTI-FID Gate 1: the fid the sim "network" saw the cast from */
  fid?: number;
}
const g = globalThis as unknown as { __layersFcSim?: Map<string, SimCast> };
g.__layersFcSim ??= new Map();

export function resetFcSimNetwork(): void {
  g.__layersFcSim = new Map();
}

export function fcSimNetworkCasts(): SimCast[] {
  return [...g.__layersFcSim!.values()];
}

/** PERSONA LAUNCH P6: the content identity of a cast that QUOTES another — the same words quoting two casts are two casts */
export function fcQuoteContentHash(text: string, parent: string | undefined, quote: string | undefined): string {
  return fcContentHash(quote ? `${text}\u0000quote:${quote}` : text, parent);
}

/** PERSONA LAUNCH P6: the thin relay (lib/fc/thinRelay.ts) records an ACCEPTED, signature-checked CastAdd into the fixture
 *  network sim, keyed (fid, content) like every per-fid sim cast; the same signed cast twice is one cast */
export function recordSimNetworkCast(c: { hash: string; text: string; parent?: string; quote?: string; fid: number; at: number }): { deduped: boolean } {
  const contentHash = fcQuoteContentHash(c.text, c.parent, c.quote);
  const key = c.fid + "|" + contentHash;
  if (g.__layersFcSim!.has(key)) return { deduped: true };
  g.__layersFcSim!.set(key, { hash: c.hash, text: c.text, contentHash, at: c.at, fid: c.fid });
  return { deduped: false };
}

interface FcTransport {
  /** MULTI-FID Gate 2: follow a fid as the acting account */
  follow(targetFid: number): Promise<void>;
  mode: "fixture" | "live";
  publish(text: string, parent?: string, quote?: string): Promise<{ hash: string }>;
  /** PERSONA LAUNCH P6: the thin relay's self-custody transport (a launched account) — no managed signer, no ledger */
  thin?: true;
  findByContentHash(contentHash: string): Promise<{ hash: string } | null>;
  react(kind: "like" | "recast", targetHash: string): Promise<void>;
  deleteCast(hash: string): Promise<void>;
}

const fixtureTransport: FcTransport = {
  mode: "fixture",
  async publish(text, parent) {
    const contentHash = fcContentHash(text, parent);
    // COMMIT FIRST (the sim network now holds the cast) ...
    const hash = "0xfc" + contentHash.slice(0, 16);
    if (!g.__layersFcSim!.has(contentHash)) {
      g.__layersFcSim!.set(contentHash, { hash, text, contentHash, at: Date.now() });
    }
    // ... THEN the response can be dropped — the ambiguous failure.
    if (consumeFcPublishDrop()) {
      throw new Error("fc transport: connection dropped mid-publish (forced)");
    }
    return { hash };
  },
  async findByContentHash(contentHash) {
    const hit = g.__layersFcSim!.get(contentHash);
    return hit ? { hash: hit.hash } : null;
  },
  async react() {
    /* sim reactions need no remote state — the ledger is the record */
  },
  async deleteCast(hash) {
    for (const [k, v] of g.__layersFcSim!) if (v.hash === hash) g.__layersFcSim!.delete(k);
  },
  async follow(_targetFid) {
    /* sim follows need no remote state — the ledger is the record */
  },
};

/** Neynar's own one-line reason for a refusal, trimmed — never anything of ours (the key travels as a header) */
async function neynarReason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const m = body && typeof body.message === "string" ? body.message.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return m ? ": " + m : "";
}

// The live transport is wired when Gate 1 produces credentials; its shape
// is fixed here so flipping is a transport swap, not a redesign. Publish
// goes through Neynar POST /v2/farcaster/cast with the throwaway's
// managed signer; findByContentHash scans the test fid's recent casts.
function liveTransport(creds: { fid: number; signerUuid: string }): FcTransport {
  const key = process.env.NEYNAR_API_KEY ?? "";
  const BASE = "https://api.neynar.com/v2/farcaster";
  return {
    mode: "live",
    async publish(text, parent) {
      const res = await fetch(`${BASE}/cast`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        // `parent` (cast hash or channel parent_url) is what makes a reply a
        // REPLY. Omitting it published replies as top-level casts — a silent
        // wrong-shape write that only the live path could ever exhibit.
        body: JSON.stringify(
          parent
            ? { signer_uuid: creds.signerUuid, text, parent }
            : { signer_uuid: creds.signerUuid, text }
        ),
      });
      if (!res.ok) {
        // BUILD A review (PUB-2, UXC-03): a 4xx is Neynar REFUSING the request (a revoked signer, a text it rejects,
        // credits) — nothing was cast, so the failure is definitive: the ledger entry is settled failed and frees its
        // slot, and the answer says "refused", never "may have gone through". A 5xx may have been cast anyway: it stays
        // ambiguous (the entry stays pending and the next attempt checks before sending).
        const e = new Error(`neynar cast failed: ${res.status}${await neynarReason(res)}`);
        throw Object.assign(e, res.status >= 400 && res.status < 500 ? { definitive: true, status: res.status } : { status: res.status });
      }
      const data = await res.json();
      return { hash: data.cast.hash };
    },
    async findByContentHash(contentHash) {
      const res = await fetch(`${BASE}/feed/user/casts?fid=${creds.fid}&limit=25`, {
        headers: { "x-api-key": key },
      });
      // THROW on failure, never null: null means "definitively not there",
      // and a transient error read as definitive-absence re-publishes — the
      // exact duplicate check-before-retry exists to prevent. The caller
      // refuses to re-send when the check itself cannot be trusted.
      if (!res.ok) throw new Error(`verify read failed: neynar ${res.status}`);
      const data = await res.json();
      // Recompute each candidate's identity from ITS OWN parent, so a reply
      // recorded as fcContentHash(text, parent) matches the reply that
      // actually landed and not a same-text top-level cast.
      const hit = (data.casts ?? []).find(
        (c: { text?: string; parent_hash?: string | null }) =>
          fcContentHash(c.text ?? "", c.parent_hash ?? undefined) === contentHash
      );
      return hit ? { hash: hit.hash } : null;
    },
    async react(kind, targetHash) {
      const res = await fetch(`${BASE}/reaction`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ signer_uuid: creds.signerUuid, reaction_type: kind, target: targetHash }),
      });
      // a non-OK RESPONSE is definitive (the server answered: it did not
      // happen); a fetch REJECTION is ambiguous (it may well have landed)
      if (!res.ok) throw Object.assign(new Error(`neynar ${kind} failed: ${res.status}${await neynarReason(res)}`), { definitive: true, status: res.status });
    },
    async deleteCast(hash) {
      const res = await fetch(`${BASE}/cast`, {
        method: "DELETE",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ signer_uuid: creds.signerUuid, target_hash: hash }),
      });
      if (!res.ok) throw Object.assign(new Error(`neynar delete failed: ${res.status}`), { definitive: true });
    },
    async follow(targetFid) {
      const res = await fetch(`${BASE}/user/follow`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ signer_uuid: creds.signerUuid, target_fids: [targetFid] }),
      });
      if (!res.ok) throw Object.assign(new Error(`neynar follow failed: ${res.status}${await neynarReason(res)}`), { definitive: true, status: res.status });
    },
  };
}

/** CONNECT MAIN review (UXC-02) — what Neynar says about a managed signer now (GET /v2/farcaster/signer, 0 credits):
 *  its status, or "missing" when Neynar no longer knows it. THROWS when it cannot be read. */
export async function liveSignerStatus(signerUuid: string): Promise<string> {
  const key = process.env.NEYNAR_API_KEY ?? "";
  if (!key || !signerUuid) throw new Error("no Neynar key or signer to ask about");
  const res = await fetch(`https://api.neynar.com/v2/farcaster/signer?signer_uuid=${encodeURIComponent(signerUuid)}`, { headers: { "x-api-key": key }, cache: "no-store" });
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error("neynar answered " + res.status);
  const b = (await res.json().catch(() => null)) as { status?: unknown } | null;
  return typeof b?.status === "string" ? b.status : "unknown";
}

/**
 * CONNECT MAIN review (UXC-02) — Farcaster refused a write as the CONNECTED main account. The page tells the owner he
 * can revoke Totem in the Farcaster app at any time, and nothing else would ever notice that he did: ask Neynar about
 * main's signer and, when it is no longer approved, record the disconnect (reason "revoked_in_app") so the Connect page
 * and the composer say "removed in the Farcaster app — connect again" instead of "Totem can post as you". Called only
 * after a DEFINITIVE refusal, which is already answered as one; a status read that itself fails changes nothing here
 * (the Connect page asks again on its next load) — this is a status refresh, never a write gate.
 */
async function noteConnectedRefusal(creds: FcCreds | null, mode: "fixture" | "live"): Promise<void> {
  if (mode !== "live" || !creds || creds.origin !== "persona" || !creds.personaId || !creds.signerUuid) return;
  try {
    const { personaFidRecord, disconnectConnectedFid } = await import("./personaFid");
    const rec = await personaFidRecord(creds.personaId);
    if (!rec || rec.origin !== "connected") return;
    const status = await liveSignerStatus(creds.signerUuid);
    if (status === "revoked" || status === "missing") await disconnectConnectedFid(creds.personaId, "revoked_in_app");
  } catch {
    /* the refusal itself was already reported in full; the next Connect page load re-checks the signer */
  }
}

/** Live iff explicitly enabled AND the throwaway exists AND the identity
 * gate passes. Everything else is the fixture sim — including every sweep. */
function transport(): FcTransport {
  if (writeEnabled() && throwawayCreds()) {
    const creds = assertThrowawayIdentity();
    return liveTransport(creds);
  }
  return fixtureTransport;
}

/** MULTI-FID PASS Gate 1: the credentials and transport for ONE persona's write. In
 * per-persona-fid mode a persona with a fid posts as itself (fixture: the sim network
 * tags the cast with that fid; live: Neynar's managed signer for that fid); otherwise
 * the shared throwaway path, exactly as before. */
async function transportFor(personaId?: string): Promise<{ t: FcTransport; creds: FcCreds | null }> {
  const { personaNetworkMode } = await import("./networkMode");
  if (personaId) {
    // PERSONA LAUNCH P6: a LAUNCHED account posts as itself, through the thin relay, signed on this device by its own
    // registered key — never the shared account, never a managed signer, in either network mode. Live is refused (the
    // thin relay has no live path this wave), and so is the simulated network under live content.
    const { personaFidRecord } = await import("./personaFid");
    const rec = await personaFidRecord(personaId);
    if (rec && rec.origin === "layers-launch") {
      const creds = await launchedCreds(rec, { personaId });
      if (rec.mode !== "fixture") throw new FcIdentityError("this launched account is a live one, and live launched accounts aren't built yet (the Totem registrar, O1) — nothing was sent");
      if (isLiveContent()) throw new FcIdentityError("this launched account lives on the simulated network — refusing a simulated write under live content");
      return { t: thinRelayTransportAs(personaId, rec.fid), creds };
    }
  }
  if (personaId && personaNetworkMode() !== "per-persona-fid") {
    // CONNECT MAIN: the shared path below would post main's words as the shared test account — main never goes there
    const { personaFidRecord } = await import("./personaFid");
    if ((await personaFidRecord(personaId))?.origin === "connected")
      throw new FcIdentityError("your main account posts only as itself — PERSONA_NETWORK_MODE=shared-fid would send it through the shared account, refused");
  }
  if (personaId && personaNetworkMode() === "per-persona-fid") {
    const { personaFidRecord } = await import("./personaFid");
    const rec = await personaFidRecord(personaId);
    if (rec) {
      const creds = await assertOwnFidIdentity({ personaId });
      if (writeEnabled() && rec.mode === "live" && creds.signerUuid) return { t: liveTransport({ fid: creds.fid, signerUuid: creds.signerUuid }), creds };
      // MULTI-FID Gate 5 (attack-fid-3 #11): under LIVE content a fixture/pending record, or a live record without a usable
      // signer, never falls to the sim — that would be a success toast for a cast that reached nothing
      if (isLiveContent()) throw new FcIdentityError("this persona's account is fixture/pending or has no usable signer — refusing a sim write under live content");
      return { t: fixtureTransportAs(creds.fid), creds };
    }
  }
  const t = transport();
  const tw = throwawayCreds();
  return { t, creds: t.mode === "live" ? { ...assertThrowawayIdentity(), origin: "throwaway" } : tw ? { ...tw, origin: "throwaway" } : null };
}

/**
 * PERSONA LAUNCH P6 — a LAUNCHED account's transport: every message is SIGNED HERE with the persona's own derived signer
 * (the key the account's KeyRegistry lists — lib/identity/keys.ts signAsFcSignerFor) and handed to the thin relay
 * (lib/fc/thinRelay.ts), which checks the key against the chain and the signature before the sim network takes it. A
 * message signed by any other key is refused there. Fixture only.
 */
function thinRelayTransportAs(personaId: string, fid: number): FcTransport {
  type Unsigned = Record<string, unknown> & { type: string };
  const sign = async (m: Unsigned): Promise<import("./thinRelay").ThinMessage> => {
    const { fcSignerPublicKeyFor, signAsFcSignerFor } = await import("@/lib/identity/keys");
    const { thinCanonical } = await import("./thinRelay");
    const signerPubKey = fcSignerPublicKeyFor(personaId);
    if (!signerPubKey) throw new FcIdentityError("this device has no signer key for that persona — nothing was sent");
    const unsigned = { ...m, signerPubKey } as unknown as import("./thinRelay").ThinMessage;
    const signature = signAsFcSignerFor(personaId, thinCanonical("fixture", unsigned));
    if (!signature) throw new FcIdentityError("this device could not sign as that persona — nothing was sent");
    return { ...unsigned, signature };
  };
  const send = async (m: import("./thinRelay").ThinMessage): Promise<{ hash: string }> => {
    const { submitThinMessage } = await import("./thinRelay");
    const r = await submitThinMessage("fixture", m);
    if (!r.ok) throw Object.assign(new Error("the thin relay refused: " + r.reason), { definitive: true, code: r.code });
    return { hash: r.hash };
  };
  return {
    mode: "fixture",
    thin: true,
    async publish(text, parent, quote) {
      return send(await sign({ type: "CastAdd", fid, timestamp: Date.now(), text, parentHash: parent ?? null, quoteHash: quote ?? null }));
    },
    async findByContentHash(contentHash) {
      const hit = g.__layersFcSim!.get(fid + "|" + contentHash);
      return hit ? { hash: hit.hash } : null;
    },
    async react(kind, targetHash) {
      await send(await sign({ type: "ReactionAdd", fid, timestamp: Date.now(), reaction: kind, targetHash }));
    },
    async deleteCast() {
      throw Object.assign(new Error("deleting a launched account's cast isn't built yet — nothing was sent"), { definitive: true });
    },
    async follow(targetFid) {
      await send(await sign({ type: "LinkAdd", fid, timestamp: Date.now(), targetFid }));
    },
  };
}

/** the fixture sim, posting under a given fid */
function fixtureTransportAs(fid: number): FcTransport {
  // MULTI-FID Gate 5 (attack-fid-3 #10): the sim keys a persona's cast on (fid, content) — the same words under
  // another fid are another cast, never a re-tag of the first
  const keyOf = (contentHash: string) => fid + "|" + contentHash;
  return {
    ...fixtureTransport,
    async publish(text, parent) {
      const contentHash = fcContentHash(text, parent);
      const key = keyOf(contentHash);
      const hash = "0xfc" + contentHashOf(key).slice(0, 16);
      if (!g.__layersFcSim!.has(key)) g.__layersFcSim!.set(key, { hash, text, contentHash, at: Date.now(), fid });
      if (consumeFcPublishDrop()) throw new Error("fc transport: connection dropped mid-publish (forced)");
      return { hash };
    },
    async findByContentHash(contentHash) {
      const hit = g.__layersFcSim!.get(keyOf(contentHash));
      return hit ? { hash: hit.hash } : null;
    },
  };
}

// ------------------------------------------------------------- operations

/** Loud gate for the live-CONTENT + writes-disabled combination: a fixture
 * "success" while the user believes they are posting publicly is the
 * silent no-op assertWriteAllowed exists to forbid. Sweeps run seed mode,
 * so this never fires there. Also runs the foreign-credential env check on
 * EVERY write — a loaded gun nearby refuses the path regardless of which
 * transport would have been selected. */
function assertFcWritePreconditions(): void {
  const legacy = process.env.NEYNAR_SIGNER_UUID;
  const creds = throwawayCreds();
  if (legacy && (!creds || legacy !== creds.signerUuid)) {
    throw new FcIdentityError(
      "a non-throwaway signer credential is present in the environment (NEYNAR_SIGNER_UUID) — refusing all Farcaster writes while an unknown identity could sign"
    );
  }
  if (isLiveContent() && !writeEnabled()) {
    // same philosophy (and shape) as assertWriteAllowed: throw loudly,
    // never no-op into a fixture success under live content
    throw new FcIdentityError(
      "Farcaster write refused: DATA_SOURCE is live but ENABLE_FC_WRITE is not \"true\" — a fixture write under live content would be a silent no-op"
    );
  }
  if (writeEnabled() && process.env.FC_TEST_CUSTODY_PRIVATE_KEY) {
    // MULTI-FID Gate 5 (attack-fid-3 #17): a custody PRIVATE KEY in the writer's environment is a loaded gun — the FC pass's
    // live scripts read it from their own env; the app never needs it
    throw new FcIdentityError("FC_TEST_CUSTODY_PRIVATE_KEY is present in the app's environment — move it out of .env.local before arming writes");
  }
  if (writeEnabled() && !creds) {
    // Writes ARMED with no throwaway identity is a misconfiguration, not a
    // fixture scenario: falling back to the sim here would fake-succeed
    // for an operator who believes they armed real publishing. (Re-review
    // finding: the transport fallback made this reachable.)
    throw new FcIdentityError(
      "ENABLE_FC_WRITE is true but no throwaway credentials are configured (FC_TEST_FID / FC_TEST_SIGNER_UUID) — refusing rather than silently writing to the fixture sim"
    );
  }
}

/**
 * BUILD A — the caller names the account. The app's buttons (app/api/actions/**) decide "this goes out under the
 * persona's OWN fid N, on transport M" before they call the door; they pass both here. If the door would choose
 * anything else — the shared throwaway (the persona's record vanished between the decision and the write), another
 * fid, the other transport — the write refuses with FcIdentityError BEFORE the ledger opens and before any network
 * attempt. That makes "the buttons never post as the shared account" structural, not a property of timing. Callers
 * that pass neither (the /api/fc/write door, the live scripts) are unchanged.
 */
export interface FcWriteGuard {
  requireFid?: number;
  requireMode?: "fixture" | "live";
}

function assertWriteGuard(t: FcTransport, creds: FcCreds | null, guard: FcWriteGuard): void {
  // an account of the persona's OWN — a persona fid ("persona") or the owner's connected main ("connected") — never the
  // shared throwaway, never another fid
  if (guard.requireFid !== undefined && (!creds || creds.origin === "throwaway" || creds.fid !== guard.requireFid)) {
    throw new FcIdentityError(
      `refusing: this write must go out under the persona's own account (fid ${guard.requireFid}), and the write door would have used ${
        !creds ? "no account" : creds.origin === "throwaway" ? "the shared account" : "a different account"
      } — nothing was sent`
    );
  }
  if (guard.requireMode !== undefined && t.mode !== guard.requireMode) {
    throw new FcIdentityError(`refusing: this write was decided for the ${guard.requireMode} network and the write door chose ${t.mode} — nothing was sent`);
  }
}

/** In-flight publishes by content hash: two concurrent publishes of the
 * same content must not both pass the prior-write check and double-send.
 * Process-local is sufficient — there is one server process, and the
 * cross-process case is what check-before-retry itself covers. */
const inFlight = new Map<string, Promise<{ hash: string; deduped: boolean; mode: "fixture" | "live"; fid: number | null }>>();

export async function publishFcCast(
  text: string,
  kind: "cast" | "reply" = "cast",
  parent?: string,
  opts: { personaId?: string; quoteOf?: string } & FcWriteGuard = {}
): Promise<{ hash: string; deduped: boolean; mode: "fixture" | "live"; fid: number | null }> {
  // PERSONA LAUNCH P6: a quote-cast's identity includes what it quotes
  const contentHash = fcQuoteContentHash(text, parent, opts.quoteOf);
  // MULTI-FID Gate 5 (attack-fid-3 #10): the same words under two fids are two casts — the in-flight identity is per acting fid
  const scopeFid = await fidScopeFor(opts.personaId);
  // BUILD A: a guarded write never joins (or leads) an in-flight publish under any other account
  if (opts.requireFid !== undefined && scopeFid !== opts.requireFid) {
    throw new FcIdentityError(`refusing: this write must go out under the persona's own account (fid ${opts.requireFid}), and it no longer resolves to it — nothing was sent`);
  }
  const inFlightKey = (scopeFid ?? "shared") + "|" + contentHash;
  const existing = inFlight.get(inFlightKey);
  // FOLLOWERS of an in-flight publish are dedupes BY DEFINITION — they
  // did not cause a new cast. Relaying the leader's deduped:false let a
  // concurrent same-text request under a different persona reattribute
  // the single cast (the route keys attribution on deduped). Re-review
  // finding, closed here at the source.
  if (existing) return existing.then((r) => ({ ...r, deduped: true }));
  const guard: FcWriteGuard = { requireFid: opts.requireFid, requireMode: opts.requireMode };
  const p = publishFcCastInner(text, kind, contentHash, parent, opts.personaId, guard, opts.quoteOf).finally(() => inFlight.delete(inFlightKey));
  inFlight.set(inFlightKey, p);
  return p;
}

/** the fid a persona's write would go out under, or null for the shared path — read only, no identity assertion */
async function fidScopeFor(personaId?: string): Promise<number | null> {
  if (!personaId) return null;
  const { personaNetworkMode } = await import("./networkMode");
  const { personaFidRecord } = await import("./personaFid");
  const rec = await personaFidRecord(personaId);
  // PERSONA LAUNCH P6: a launched account always writes as itself, whatever the network mode
  if (rec?.origin === "layers-launch") return rec.fid;
  if (personaNetworkMode() !== "per-persona-fid") return null;
  return rec?.fid ?? null;
}

async function publishFcCastInner(
  text: string,
  kind: "cast" | "reply",
  contentHash: string,
  parent?: string,
  personaId?: string,
  guard: FcWriteGuard = {},
  quoteOf?: string
): Promise<{ hash: string; deduped: boolean; mode: "fixture" | "live"; fid: number | null }> {
  assertFcWritePreconditions();
  // MULTI-FID Gate 1: the acting persona's own fid in per-persona-fid mode, else the shared path
  const { t, creds } = await transportFor(personaId);
  assertWriteGuard(t, creds, guard);
  if (t.mode === "live" && (!creds || creds.origin === "throwaway")) assertThrowawayIdentity();
  // PERSONA LAUNCH P6: a quote reaches the network only through a launched account's thin relay (the guard bounds it)
  if (quoteOf && !t.thin) throw new FcIdentityError("quote posts aren't sent to Farcaster yet (only a launched account's quotes of its own revealed anonymous posts are) — nothing was sent");
  // CONNECT MAIN: main and the other own accounts never reply to or mention each other — before the ledger and the network
  await assertNoSelfLink(personaId, { parentHash: parent, text, ...(quoteOf ? { quoteHash: quoteOf } : {}) }, t.mode);
  if (t.thin) {
    // PERSONA LAUNCH P6 — A LAUNCHED ACCOUNT'S OWN PATH. Its message is signed here by its own registered key and the
    // thin relay checks it in-process, synchronously: there is no ambiguous outcome to ledger for check-before-retry,
    // and no managed signer, so the service's managed-signer daily cap (FC_CASTS_PER_DAY, the Neynar budget) is not its
    // limit — the network's per-fid message limit is, enforced by the relay. The same signed cast twice is one cast.
    const prior = await t.findByContentHash(contentHash);
    if (prior) return { hash: prior.hash, deduped: true, mode: t.mode, fid: creds?.fid ?? null };
    const { hash } = await t.publish(text, parent, quoteOf);
    return { hash, deduped: false, mode: t.mode, fid: creds?.fid ?? null };
  }

  // check-before-retry: a prior pending/sent entry for this content IN
  // THIS TRANSPORT'S MODE is verified against the network, never trusted
  // from the ledger alone. MODE-SCOPED (re-review finding): a preserved
  // LIVE receipt must never be "verified" against the fixture sim — the
  // sim's emptiness says nothing about the real network, and settling the
  // live receipt failed there would free real cap budget and destroy the
  // receipt for a cast still standing publicly. Cross-mode priors are
  // simply not this publish's concern.
  // MULTI-FID Gate 5 (attack-fid-3 #10): the prior is the one under THIS fid — another persona's same text is another cast.
  // BUILD A review (UXC-04): a PENDING prior (outcome unknown) at any age, a SENT one only from the last few minutes
  // (lib/fc/writeLedger.ts FC_RETRY_WINDOW_MS) — "gm" tomorrow is a new post, not a retry of today's.
  const prior = priorWriteFor(contentHash, creds?.fid ?? null);
  const what = kind === "reply" ? "reply" : "post";
  if (prior && prior.mode === t.mode) {
    let found: { hash: string } | null;
    try {
      found = await t.findByContentHash(contentHash);
    } catch (e) {
      // THE CHECK ITSELF FAILED. Re-sending here is exactly the duplicate
      // the check exists to prevent — refuse and keep the entry as-is so
      // a later attempt re-runs the check. Fail closed, not open.
      throw new FcRetryCheckError(
        `Totem couldn't check whether your earlier attempt of this exact ${what} reached Farcaster (${(e as Error).message}) — nothing was sent. Try again in a moment.`
      );
    }
    if (found) {
      if (prior.status === "pending") await settleWrite(prior.id, "sent", found.hash);
      return { hash: found.hash, deduped: true, mode: t.mode, fid: creds?.fid ?? null };
    }
    if (t.mode === "live") {
      if (prior.status === "pending") {
        // The live verify scans a BOUNDED window (the fid's recent casts) —
        // "not in the window" is a can't-see condition, not proof of
        // absence. An attempt whose outcome is UNKNOWN may still be out
        // there: settling it failed and re-publishing could mint the
        // duplicate this whole mechanism exists to prevent. REFUSE, and say
        // what the owner can do — the words are blocked, nothing else is.
        throw new FcRetryUnconfirmedError(
          `An earlier attempt to send this exact ${what} from this account may have reached Farcaster, and it isn't among the account's latest casts, so Totem won't send it again (that could make a duplicate public ${what}). Nothing was sent. Check the account on Farcaster: if it's there, you're done; if not, change the wording slightly and send it again.`
        );
      }
      // a SENT receipt from the last few minutes that the window no longer shows (deleted on Farcaster, or pushed out
      // of the latest casts): it was confirmed, so sending the same words again is a deliberate new post — it goes out
      // below, and the earlier receipt stays exactly as it was (it reached the network, and keeps its slot of the cap)
    } else {
      // fixture: the sim IS the whole network — absence is definitive
      await settleWrite(prior.id, "failed");
    }
  }

  assertFcWriteAllowed(kind, t.mode);
  const entry = await openWrite({
    kind,
    contentHash,
    fid: creds?.fid ?? throwawayCreds()?.fid ?? null,
    mode: t.mode,
    note: `${kind}: ${text.slice(0, 60)}`,
  });
  // outcome-unknown failures leave the entry PENDING so the next attempt
  // runs the check instead of blind-retrying. BUILD A review (PUB-2): a DEFINITIVE refusal (the network answered no)
  // settles it failed — nothing was cast, so it holds no slot of the shared daily cap and blocks no retry of the words
  let hash: string;
  try {
    ({ hash } = await t.publish(text, parent));
  } catch (e) {
    if (isDefinitiveFailure(e)) {
      await settleWrite(entry.id, "failed");
      await noteConnectedRefusal(creds, t.mode);
    }
    throw e;
  }
  await settleWrite(entry.id, "sent", hash);
  return { hash, deduped: false, mode: t.mode, fid: creds?.fid ?? null };
}

export async function reactFc(kind: "like" | "recast", targetHash: string, opts: { personaId?: string } & FcWriteGuard = {}): Promise<{ mode: string; fid: number | null }> {
  assertFcWritePreconditions();
  const { t, creds } = await transportFor(opts.personaId);
  assertWriteGuard(t, creds, opts);
  if (t.mode === "live" && (!creds || creds.origin === "throwaway")) assertThrowawayIdentity();
  // CONNECT MAIN: no like or recast between main and another own account, either way
  await assertNoSelfLink(opts.personaId, { targetHash }, t.mode);
  if (t.thin) {
    // PERSONA LAUNCH P6: a launched account's reaction — signed here, checked by the thin relay (see publishFcCastInner)
    await t.react(kind, targetHash);
    return { mode: t.mode, fid: creds?.fid ?? null };
  }
  assertFcWriteAllowed(kind, t.mode);
  const entry = await openWrite({
    kind,
    castHash: targetHash,
    fid: creds?.fid ?? throwawayCreds()?.fid ?? null,
    mode: t.mode,
    note: `${kind} ${targetHash}`,
  });
  try {
    await t.react(kind, targetHash);
  } catch (e) {
    // "failed" frees the cap slot, so it is reserved for DEFINITIVE
    // refusals (the server answered no). An ambiguous transport rejection
    // may have landed — that entry stays PENDING and keeps holding its
    // budget: a flaky transport must not become an uncapped retry hammer.
    // (Re-review finding — the ledger's own "failed means proved" rule.)
    if (isDefinitiveFailure(e)) {
      await settleWrite(entry.id, "failed");
      await noteConnectedRefusal(creds, t.mode);
    }
    throw e;
  }
  await settleWrite(entry.id, "sent", targetHash);
  return { mode: t.mode, fid: creds?.fid ?? null };
}

export async function deleteFcCast(hash: string, opts: { personaId?: string } = {}): Promise<{ mode: string; fid: number | null }> {
  assertFcWritePreconditions();
  const { t, creds } = await transportFor(opts.personaId);
  if (t.mode === "live" && (!creds || creds.origin === "throwaway")) assertThrowawayIdentity();
  assertFcWriteAllowed("delete", t.mode);
  const entry = await openWrite({
    kind: "delete",
    castHash: hash,
    fid: creds?.fid ?? throwawayCreds()?.fid ?? null,
    mode: t.mode,
    note: `delete ${hash}`,
  });
  try {
    await t.deleteCast(hash);
  } catch (e) {
    // same definitive-vs-ambiguous rule as reactions
    if ((e as { definitive?: boolean }).definitive) await settleWrite(entry.id, "failed");
    throw e;
  }
  await settleWrite(entry.id, "sent", hash);
  return { mode: t.mode, fid: creds?.fid ?? null };
}

/** MULTI-FID PASS Gate 2: follow a fid AS a persona (its own account in per-persona-fid mode). Ledgered
 * like every other action, counted against the actions cap; fixture: the ledger is the record. */
export async function followFc(targetFid: number, opts: { personaId?: string } & FcWriteGuard = {}): Promise<{ mode: string; fid: number | null }> {
  assertFcWritePreconditions();
  if (!Number.isInteger(targetFid) || targetFid <= 0) throw new Error("targetFid malformed");
  const { t, creds } = await transportFor(opts.personaId);
  assertWriteGuard(t, creds, opts);
  if (t.mode === "live" && (!creds || creds.origin === "throwaway")) assertThrowawayIdentity();
  // CONNECT MAIN: main never follows another own account, and no other own account follows main
  await assertNoSelfLink(opts.personaId, { targetFid }, t.mode);
  if (t.thin) {
    // PERSONA LAUNCH P6: a launched account's follow — signed here, checked by the thin relay (see publishFcCastInner)
    await t.follow(targetFid);
    return { mode: t.mode, fid: creds?.fid ?? null };
  }
  assertFcWriteAllowed("follow", t.mode);
  const entry = await openWrite({
    kind: "follow",
    castHash: null,
    // BUILD A: the followed account, so "already following" is a ledger fact (the app's Follow button reads it)
    targetFid,
    fid: creds?.fid ?? throwawayCreds()?.fid ?? null,
    mode: t.mode,
    note: `follow fid ${targetFid}`,
  });
  try {
    await t.follow(targetFid);
  } catch (e) {
    if (isDefinitiveFailure(e)) {
      await settleWrite(entry.id, "failed");
      await noteConnectedRefusal(creds, t.mode);
    }
    throw e;
  }
  await settleWrite(entry.id, "sent", null);
  return { mode: t.mode, fid: creds?.fid ?? null };
}
