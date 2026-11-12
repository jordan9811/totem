import "server-only";
// BUILD A — THE APP'S BUTTONS THROUGH THE FARCASTER WRITE DOOR (the owner service).
//
// Post, Reply, Like, Recast and Follow used to stop at Totem's own store: /api/actions/cast called addLocalCast and the
// Composer toasted a generic "sent" while nothing reached Farcaster. This module is the one place the action routes
// (cast, react, follow, act-as, delivery) ask their two questions, and the only place the answers are worded.
//
//   1. WHERE DOES THIS PERSONA'S ACTION GO?  deliveryFor() answers Farcaster ONLY when every one of these holds:
//        - real writes are armed on this process (ENABLE_FC_WRITE), or, on a test rig, the fixture knob below
//        - one persona, one account (PERSONA_NETWORK_MODE per-persona-fid): the buttons never post through the shared
//          account, in either mode
//        - the persona is one of this device's own, and public
//        - it owns its OWN Farcaster record: LIVE on an armed service (a fixture or pending record never sim-writes
//          there), with a usable managed signer, not the shared test account's fid, and passing the write door's own
//          identity rule (assertOwnFidIdentity: the keys are the persona's by derivation; a connected main account
//          passes through its own branch there)
//      Anything else is "in Totem only", with the reason in words; a persona with no account is pointed at the command
//      that creates one. NEVER THE SHARED TEST ACCOUNT: the write door falls back to it for a persona without a record,
//      so the buttons never call the door without one, and every call names the persona's own fid (requireFid,
//      lib/fc/writes.ts), so a record that vanished mid-request refuses instead of falling back.
//
//   2. IS THE TARGET ON FARCASTER, AND MAY THIS PERSONA TOUCH IT THERE?  classifyTarget() and followVerdict():
//        - only a Farcaster cast can be replied to, liked or recast on Farcaster; a local, seeded, private or anonymous
//          post stays in Totem (an anon post: acting on it from a persona would tie the two)
//        - D-FID-5-NO-CLIENT-FINGERPRINT: from a one-tap button a persona never touches another of the owner's own
//          accounts on Farcaster: another persona (Act as... keeps its waiver, A-FID-SELF-GRAPH, shown where it is
//          used), the shared Totem test account, the anonymous account and the reserved Totem fids, or the owner's
//          main account — the CONNECTED record, or as this service is configured (NEYNAR_VIEWER_FID, the runbook's
//          "your real fid"). On the real network, while neither names main, an interaction is REFUSED (it might be
//          the link — never fail open); a plain post touches no one. The write door's own guard (assertNoSelfLink)
//          keeps main apart from everything else on top of this, for every caller.
//        - who wrote a cast: the attribution index (casts made through Totem) and the account that published it
//          (the ledger, the local copy), the sim network, the card's own author fid, else a live cast lookup. A
//          lookup that fails REFUSES: never fail open.
//
//   3. IS IT STILL WHAT THE OWNER SAW? The Composer shows the answer to 1 before the click and sends it back with the
//      post (`expect`); the post is decided again and REFUSED (409 FC_DELIVERY_CHANGED, nothing sent, the fresh line
//      returned) when the two differ in where, as whom or under which account — the acting-persona cookie is shared by
//      every tab, and an account can be created while a tab is open. Likes, recasts and follows carry the persona the
//      card was rendered for (`actingPersonaId`) and are refused the same way when it is not the acting one now.
//
// The write door keeps everything it had: the identity rule, ledger-before-network, check-before-retry, the daily caps
// and the follow budget. Nothing here goes around it.
//
// PERSONA LAUNCH P6 — A LAUNCHED ACCOUNT (origin "layers-launch", lib/launch/*). Launch gives a persona its own account,
// created by the (simulated) Totem registrar, whose signer is the persona's OWN key. Its "direct" path is the thin relay
// (lib/fc/writes.ts transportFor → lib/fc/thinRelay.ts), on the SIMULATED network this wave:
//   - with writes off (every rig, every preview), a launched persona whose owner CHOSE "direct" posts to its own account
//     on the simulated network — the one I/O on that path is its account record, read only after the keystore says
//     "direct" (an explicit choice; the default for a launched persona is anon, D2)
//   - with no choice made yet (choiceRequired) it answers Totem only (post_mode_anon: preset anon) in every case
//   - armed for real writes, a launched account is a simulated one: account_not_live (never a sim write beside a real one)
//   - every answer runs the write door's own identity rule (assertOwnFidIdentity → its launched-account branch)
import { NextResponse } from "next/server";
import { personaById, persistNs, state } from "@/lib/adapters/mock/store";
import { getPersona } from "@/lib/identity/keystore";
import { isViewerPersona, signForPersona } from "@/lib/identity/keys";
import { kindOf } from "@/lib/identity/personaKind";
import { isLiveContent, writeEnabled } from "@/lib/adapters/neynar/mode";
import { personaNetworkMode } from "@/lib/fc/networkMode";
import { allPersonaFids, connectedRecords, ownAccountFidsWithAnon, personaFidRecord, personaOfFid } from "@/lib/fc/personaFid";
import {
  FcIdentityError,
  FcRetryCheckError,
  FcRetryUnconfirmedError,
  MAIN_UNKNOWN_SENTENCE,
  assertOwnFidIdentity,
  configuredMainFid,
  fcSimNetworkCasts,
  isDefinitiveFailure,
  throwawayCreds,
} from "@/lib/fc/writes";
import { FcWriteCapError, fcWrites } from "@/lib/fc/writeLedger";
import { attributionCanonical } from "@/lib/fc/attribution";
import { isNetworkCastTarget, isNetworkHashShape } from "@/lib/fc/networkTarget";
import { isEmptyWorld } from "@/lib/world-flag";

export type Verb = "cast" | "reply" | "like" | "recast" | "follow" | "quote";

export type DeliveryReason =
  | "writes_off"
  | "shared_mode"
  | "not_own"
  | "unknown_kind"
  | "private"
  | "no_account"
  | "account_not_live"
  | "no_signer"
  | "throwaway"
  | "target_local"
  | "target_anon"
  | "quote"
  | "undo_local"
  | "main_disconnected"
  | "main_removed"
  // PERSONA LAUNCH P3 (D2): the owner set this persona to post in Totem only (an EXPLICIT choice; the default never
  // lands here — lib/identity/postMode.ts)
  | "post_mode_private"
  // PERSONA LAUNCH P3 (PRIV-2): the owner set this persona to post through @anon — an EXPLICIT choice, made on a persona
  // that may own an account (postModeView offers "anon" to every public persona). Its plain posts and every button then
  // stay in Totem: a persona reaches its OWN account only in "direct" mode or with no choice made (the default for a
  // persona with an account). Before this, the choice was ignored here and an unticked or failed anon toggle published
  // publicly under the very name the owner had opted out of.
  | "post_mode_anon";

/** What one action did, or would do, in words the UI shows as-is. */
export interface FcDelivery {
  to: "farcaster" | "layers";
  personaId: string | null;
  handle: string | null;
  /** Farcaster only: the persona's own account and the network it goes to */
  fid?: number;
  fname?: string | null;
  mode?: "fixture" | "live";
  /** Totem only: why */
  reason?: DeliveryReason;
  /** the one honest sentence */
  message: string;
  /** a persona with no account: what creates one */
  pointer?: string;
  /** results: the cast, where to see it, and whether nothing new went out */
  hash?: string;
  url?: string | null;
  deduped?: boolean;
  already?: boolean;
  warning?: string;
  /** the pre-post probe only: posting this would be refused (the message says why) */
  refused?: boolean;
}

export type FarcasterDelivery = FcDelivery & { to: "farcaster"; personaId: string; handle: string; fid: number; mode: "fixture" | "live" };

export function isFarcaster(d: FcDelivery): d is FarcasterDelivery {
  return d.to === "farcaster" && typeof d.fid === "number" && !!d.personaId && !!d.mode;
}

// ------------------------------------------------------------------------------------------------------------ words

function handleOf(personaId: string): string | null {
  try {
    const minted = getPersona(personaId);
    if (minted) return minted.handle;
  } catch {
    /* an unreadable keystore names nothing — the seeded map may still */
  }
  return personaById.get(personaId)?.handle ?? null;
}

export function networkName(mode: "fixture" | "live" | undefined): string {
  return mode === "fixture" ? "Farcaster (simulated network)" : "Farcaster";
}

function reasonText(reason: DeliveryReason, handle: string | null): string {
  const who = handle ? "@" + handle : "this persona";
  switch (reason) {
    case "writes_off":
      return "Farcaster posting is off on this service";
    case "shared_mode":
      return "this service runs personas through one shared Farcaster account, and the app's buttons never post through it";
    case "not_own":
      return `${who} isn't one of your personas`;
    case "unknown_kind":
      return `Totem couldn't establish that ${who} is a public persona`;
    case "private":
      return "private personas never post to Farcaster";
    case "no_account":
      return `${who} has no Farcaster account yet`;
    case "account_not_live":
      return `${who}'s Farcaster account isn't live yet`;
    case "no_signer":
      return `${who}'s Farcaster account has no working signer`;
    case "throwaway":
      return `${who}'s account record points at the shared test account, which these buttons never use`;
    case "target_local":
      return "that post isn't on Farcaster";
    case "target_anon":
      return `that's an anonymous post, and doing this from ${who} on Farcaster would tie ${who} to it`;
    case "quote":
      return "quote posts aren't sent to Farcaster yet";
    case "undo_local":
      return "nothing changed on Farcaster";
    case "main_disconnected":
      return "your main account is disconnected from Totem — connect it again in Settings › Connect your Farcaster account";
    case "main_removed":
      return "your main account removed Totem in the Farcaster app — connect it again in Settings › Connect your Farcaster account";
    case "post_mode_private":
      return `${who} is set to post in Totem only`;
    case "post_mode_anon":
      return `${who} is set to post through @anon`;
  }
}

const LAYERS_VERB: Record<Verb, string> = { cast: "Saved", reply: "Saved", like: "Liked", recast: "Recast", follow: "Followed", quote: "Quoted" };

/** "<Verb> in Totem only — <why>" (a follow has no Totem-only form: "Not followed — <why>") */
export function layersMessage(verb: Verb, reason: DeliveryReason, handle: string | null): string {
  if (verb === "follow") return `Not followed — ${reasonText(reason, handle)}`;
  if (reason === "undo_local") return `${verb === "recast" ? "Recast" : "Like"} removed in Totem only — nothing changed on Farcaster`;
  if (reason === "target_local" && verb === "reply") return "Saved in Totem only — the post you replied to isn't on Farcaster";
  return `${LAYERS_VERB[verb]} in Totem only — ${reasonText(reason, handle)}`;
}

/** the name the account goes by ON FARCASTER: its fname (the protocol's grammar can differ from the Totem handle —
 *  "pub_one" registers as "pub-one"), else the persona's handle */
export function farcasterName(d: { fname?: string | null; handle?: string | null }): string {
  return "@" + (d.fname || d.handle || "this persona");
}

function farcasterMessage(verb: Verb, d: FarcasterDelivery, x: { deduped?: boolean; already?: boolean; target?: string }): string {
  const net = networkName(d.mode);
  const who = farcasterName(d);
  switch (verb) {
    case "cast":
      return x.deduped ? `Already on ${net} as ${who} — this exact text was posted before, so nothing new went out` : `Posted to ${net} as ${who}`;
    case "reply":
      return x.deduped ? `Already on ${net} as ${who} — this exact reply was posted before, so nothing new went out` : `Replied on ${net} as ${who}`;
    case "like":
      return x.already ? `Already liked on ${net} as ${who}` : `Liked on ${net} as ${who}`;
    case "recast":
      return x.already ? `Already recast on ${net} as ${who}` : `Recast on ${net} as ${who}`;
    case "follow":
      return x.already ? `Already following ${x.target ?? "that account"} on ${net} as ${who}` : `Following ${x.target ?? "that account"} on ${net} as ${who}`;
    case "quote":
      return `Quoted on ${net} as ${who}`;
  }
}

/** the persona-level answer re-worded for one verb, Totem-only */
export function layersOnly(d: FcDelivery, reason: DeliveryReason, verb: Verb): FcDelivery {
  return {
    to: "layers",
    personaId: d.personaId,
    handle: d.handle,
    reason,
    message: layersMessage(verb, reason, d.handle),
    ...(reason === "no_account" && d.pointer ? { pointer: d.pointer } : {}),
  };
}

/** the same answer re-worded for one verb (a Totem-only answer keeps its reason) */
export function forVerb(d: FcDelivery, verb: Verb): FcDelivery {
  if (d.to === "layers" && d.reason) return { ...layersOnly(d, d.reason, verb), ...(d.pointer ? { pointer: d.pointer } : {}) };
  return d;
}

/** a Farcaster result: the sentence, the cast and where to see it */
export function farcasterResult(
  d: FarcasterDelivery,
  verb: Verb,
  x: { hash?: string; deduped?: boolean; already?: boolean; target?: string; warning?: string } = {}
): FcDelivery {
  return {
    to: "farcaster",
    personaId: d.personaId,
    handle: d.handle,
    fid: d.fid,
    fname: d.fname ?? null,
    mode: d.mode,
    message: farcasterMessage(verb, d, x),
    ...(x.hash ? { hash: x.hash, url: castUrl(d, x.hash) } : {}),
    ...(x.deduped ? { deduped: true } : {}),
    ...(x.already ? { already: true } : {}),
    ...(x.warning ? { warning: x.warning } : {}),
  };
}

/** the cast on farcaster.xyz — the short-hash form the FC pass verified live (scripts/live-fc4.mjs); the simulated
 *  network has no public address */
export function castUrl(d: { mode?: "fixture" | "live"; fname?: string | null; handle?: string | null }, hash: string): string | null {
  if (d.mode !== "live") return null;
  const name = d.fname || d.handle;
  return name ? `https://farcaster.xyz/${encodeURIComponent(name)}/${hash.slice(0, 10)}` : null;
}

function pointerFor(personaId: string, handle: string | null): string {
  return `Give ${handle ? "@" + handle : "this persona"} its own account from your laptop: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\owner\\acquire-fid.ps1 -PersonaId ${personaId} (notes/runbooks/GO-LIVE-MORNING.md step 3). Settings › Account & Personas shows its Farcaster ID once it has one.`;
}

// -------------------------------------------------------------------------------------- the rig's fixture knob
//
// A test rig never arms real writes, so without this the buttons' Farcaster path could only be exercised live. The knob
// lets the rig suite (scripts/accept-fc-buttons.mjs) send the buttons through the write door on the SIMULATED network,
// for personas whose account record is a fixture one. It is refused unless ZK_DEV_HOOKS=true, and refused whenever real
// writes are armed, on the owner service, under LAYERS_WORLD=empty and under live content — so it can only ever select
// the simulated network, never sit next to a real one. It is bound to the store object it was armed against: a seed
// reset replaces that object, which disarms the knob with it (the reset contract: a knob a test can arm, a reset
// disarms). In-process only; a restart forgets it.

const gk = globalThis as unknown as { __layersFcButtonsFixture?: { state: object } | null };

function ownerServiceProcess(): boolean {
  return typeof window === "undefined" && (process.env.OWNER_ACCESS_SECRET ?? "").trim() !== "";
}

function knobRefusal(): string | null {
  if (process.env.ZK_DEV_HOOKS !== "true") return "refused unless ZK_DEV_HOOKS=true (a test rig only)";
  if (writeEnabled()) return "refused while real Farcaster writes are armed (ENABLE_FC_WRITE) — the knob only ever selects the simulated network";
  if (ownerServiceProcess()) return "refused on the owner service";
  if (isEmptyWorld()) return "refused under LAYERS_WORLD=empty";
  if (isLiveContent()) return "refused while DATA_SOURCE is live (the write door refuses the simulated network under live content)";
  return null;
}

export function fixtureDeliveryArmed(): boolean {
  const k = gk.__layersFcButtonsFixture;
  if (!k) return false;
  if (k.state !== state()) {
    gk.__layersFcButtonsFixture = null; // a seed reset replaced the store: the knob went with it
    return false;
  }
  return knobRefusal() === null;
}

export function setFixtureDelivery(on: boolean): { ok: true; armed: boolean } | { ok: false; error: string } {
  if (!on) {
    gk.__layersFcButtonsFixture = null;
    return { ok: true, armed: false };
  }
  const refusal = knobRefusal();
  if (refusal) return { ok: false, error: "fixture delivery " + refusal };
  gk.__layersFcButtonsFixture = { state: state() };
  return { ok: true, armed: true };
}

// ------------------------------------------------------------------------------------------- 1. the persona

/**
 * Where an action by this persona goes. Answers WITHOUT any I/O when writes are off and the knob is not armed — the
 * rig's and the public preview's every button, unchanged. THROWS when the account record cannot be read (the vault is
 * unreachable: the caller refuses, never "no account") and FcIdentityError when the write door's identity rule refuses
 * the record (the exact refusal).
 */
export async function deliveryFor(personaId: string | null | undefined): Promise<FcDelivery> {
  const id = personaId || null;
  const armed = writeEnabled();
  const knob = !armed && fixtureDeliveryArmed();
  const handle = id && (armed || knob) ? handleOf(id) : null;
  const layers = (reason: DeliveryReason, extra: Partial<FcDelivery> = {}): FcDelivery => ({
    to: "layers",
    personaId: id,
    handle,
    reason,
    message: layersMessage("cast", reason, handle),
    ...extra,
  });
  if (!armed && !knob) {
    // PERSONA LAUNCH P6: a launched persona with "direct" CHOSEN posts to its own (simulated) account — see the header
    const launched = id && getPersona(id)?.postMode === "direct" ? await launchedDirectDelivery(id) : null;
    return launched ?? layers("writes_off");
  }
  if (!id || !isViewerPersona(id)) return layers("not_own");
  const kind = kindOf(id);
  if (kind === "private") return layers("private");
  if (kind !== "public") return layers("unknown_kind");
  // PERSONA LAUNCH P3 (D2): an EXPLICIT "private" post mode keeps every action of this persona in Totem. Read from the
  // keystore record only (no vault or network I/O; a keystore that cannot be read was answered by kindOf above). The
  // default — no choice made — never changes this answer.
  if (getPersona(id)?.postMode === "private") return layers("post_mode_private");
  // PERSONA LAUNCH P3 (PRIV-2): an EXPLICIT "anon" mode keeps the persona off its own account too — the composer's anon
  // toggle is the only way its words leave Totem (through @anon). Same read, same no-I/O rule as the line above.
  if (getPersona(id)?.postMode === "anon") return layers("post_mode_anon");
  {
    // PERSONA LAUNCH P6: a launched account answers by its own rules, in either network mode (it never uses the shared
    // account, so PERSONA_NETWORK_MODE does not apply to it). THROWS on an unreadable vault.
    const own = await personaFidRecord(id);
    if (own && String(own.origin) === "layers-launch") {
      if (!getPersona(id)?.postMode) return layers("post_mode_anon"); // D2: preset anon until the owner chooses
      if (armed || own.mode !== "fixture" || isLiveContent()) return layers("account_not_live");
      return (await launchedDirectDelivery(id)) ?? layers("account_not_live");
    }
  }
  if (personaNetworkMode() !== "per-persona-fid") return layers("shared_mode");
  const rec = await personaFidRecord(id); // THROWS on an unreadable vault
  if (!rec) return layers("no_account", { pointer: pointerFor(id, handle) });
  const tw = throwawayCreds();
  if (tw && rec.fid === tw.fid) return layers("throwaway");
  const connected = String(rec.origin) === "connected";
  // CONNECT MAIN review (UXC-02): a main account that was disconnected — here, or by removing Totem in the Farcaster
  // app (the write door records that when Farcaster refuses main's signer, and the Connect page checks on load) —
  // posts in Totem only, and says why and where to reconnect
  if (connected && rec.connected?.disconnectedAt) return layers(rec.connected.disconnectReason === "revoked_in_app" ? "main_removed" : "main_disconnected");
  if (armed) {
    if (rec.mode !== "live") return layers("account_not_live");
    // a connected main account's signer is the identity rule's to judge below (its refusal says how to reconnect)
    if (!connected && (rec.signer.kind !== "neynar-managed" || !rec.signer.uuid)) return layers("no_signer");
  } else if (rec.mode !== "fixture") {
    // the knob selects the SIMULATED network: a live account never writes there (a fake success for a real account)
    return layers("account_not_live");
  }
  // the write door's own identity rule, the same call it makes at write time — FcIdentityError is the exact refusal
  const creds = await assertOwnFidIdentity({ personaId: id });
  if (creds.origin === "throwaway" || creds.fid !== rec.fid)
    throw new FcIdentityError("the write door resolved this persona to an account other than its own record — refusing");
  const mode: "fixture" | "live" = armed ? "live" : "fixture";
  return {
    to: "farcaster",
    personaId: id,
    handle: handle ?? id,
    fid: rec.fid,
    fname: rec.fname,
    mode,
    message: `Posts to ${networkName(mode)} as ${farcasterName({ fname: rec.fname, handle: handle ?? id })} — public`,
  };
}

/**
 * PERSONA LAUNCH P6 — the Farcaster answer for a LAUNCHED persona whose owner chose "direct": its own account on the
 * SIMULATED network, through the thin relay. null when it is not one (no launched record, a live record, live content,
 * not this device's public persona). THROWS on an unreadable vault, and FcIdentityError when the write door's own
 * identity rule refuses the record.
 */
async function launchedDirectDelivery(id: string): Promise<FcDelivery | null> {
  if (!isViewerPersona(id) || kindOf(id) !== "public" || getPersona(id)?.postMode !== "direct") return null;
  const rec = await personaFidRecord(id); // THROWS on an unreadable vault
  if (!rec || String(rec.origin) !== "layers-launch" || rec.mode !== "fixture" || isLiveContent()) return null;
  const creds = await assertOwnFidIdentity({ personaId: id });
  if (creds.origin === "throwaway" || creds.fid !== rec.fid) throw new FcIdentityError("the write door resolved this launched persona to an account other than its own — refusing");
  const handle = handleOf(id) ?? id;
  return {
    to: "farcaster",
    personaId: id,
    handle,
    fid: rec.fid,
    fname: rec.fname,
    mode: "fixture",
    message: `Posts to ${networkName("fixture")} as ${farcasterName({ fname: rec.fname, handle })} — public`,
  };
}

// ------------------------------------------------------------------------------------------- 2. the target

export type TargetVerdict =
  | { verdict: "farcaster"; authorPersonaId: string | null; authorFid: number | null }
  | { verdict: "layers"; reason: "target_local" | "target_anon" }
  | { verdict: "refuse"; status: number; code: string; message: string };

/** CONNECT MAIN review (PUB-3, PL-1) — the owner's main account as this service knows it: the CONNECTED record (Build
 *  B; it stays main after a disconnect) and NEYNAR_VIEWER_FID, the runbook's "your real fid" (unset reads fid 3's feed,
 *  which is not the owner's) — the second covers the days before main is connected. THROWS on an unreadable vault:
 *  the caller refuses. */
async function mainAccount(): Promise<{ fids: Set<number>; personaIds: Set<string> }> {
  const recs = await connectedRecords();
  const fids = new Set(recs.map((r) => r.fid));
  const personaIds = new Set(recs.map((r) => r.personaId));
  const configured = configuredMainFid();
  if (configured !== null) fids.add(configured);
  return { fids, personaIds };
}

const MAIN_APART = "Your main account never interacts with your other accounts on Farcaster.";

/** this process's local copy of a cast (the Farcaster path keeps one under the network hash), its persona, and the
 *  account it went out under (the Composer's copy carries the persona's own fid) */
async function localCopy(hash: string): Promise<{ personaId: string | null; fid: number | null } | null> {
  const { findLocalCast } = await import("@/lib/data");
  const local = findLocalCast(hash) as ({ personaId?: string | null; text?: string; author?: { fid?: unknown } } | null);
  if (!local) return null;
  const fid = Number(local.author?.fid);
  return {
    personaId: local.personaId ?? local.text?.match(/layers:persona:(\S+)/)?.[1] ?? null,
    fid: Number.isInteger(fid) && fid > 0 ? fid : null,
  };
}

/** BUILD A review (PUB-7) — the account a cast made THROUGH LAYERS went out under: its own ledgered publish (a persona's
 *  own fid, or the shared test account's when it was sent for a persona without one). null = not ledgered here. */
function publishedFid(hash: string): number | null {
  const e = fcWrites().find((x) => (x.kind === "cast" || x.kind === "reply") && x.castHash === hash && x.status !== "failed" && x.status !== "refused");
  return e && typeof e.fid === "number" && e.fid > 0 ? e.fid : null;
}

/** the author fid of a network cast, read live (Neynar's cast lookup through the cached adapter). null = the network
 *  has no such cast; THROWS when it could not be read. */
async function liveAuthorFid(hash: string): Promise<number | null> {
  const { liveCast, NeynarError } = await import("@/lib/adapters/neynar/content");
  try {
    const r = await liveCast(hash);
    const fid = Number(r.value?.author?.fid);
    if (!Number.isInteger(fid) || fid <= 0) throw new Error("the lookup named no author");
    return fid;
  } catch (e) {
    if (e instanceof NeynarError && e.status === 404) return null;
    throw e;
  }
}

async function guardAuthor(
  d: FarcasterDelivery,
  authorPersonaId: string | null,
  authorFid: number | null,
  opts: { siblingsAllowed?: boolean }
): Promise<TargetVerdict> {
  const main = await mainAccount(); // THROWS on an unreadable vault: the caller refuses
  // PUB-3 / PL-1: on the real network an interaction is never decided on a guess about which account is main
  if (d.mode === "live" && main.fids.size === 0) return { verdict: "refuse", status: 409, code: "FC_MAIN_UNKNOWN", message: "Not sent — " + MAIN_UNKNOWN_SENTENCE };
  const actorIsMain = main.personaIds.has(d.personaId) || main.fids.has(d.fid);
  const authorIsMain = (authorFid !== null && main.fids.has(authorFid)) || (!!authorPersonaId && main.personaIds.has(authorPersonaId));
  if (authorIsMain && !actorIsMain) {
    return {
      verdict: "refuse",
      status: 403,
      code: "FC_SELF_LINK",
      message: `Not sent — that's your main Farcaster account${authorFid !== null && main.fids.has(authorFid) ? ` (fid ${authorFid})` : ""}. ${MAIN_APART}`,
    };
  }
  const tw = throwawayCreds();
  if (tw && authorFid === tw.fid) {
    return { verdict: "refuse", status: 403, code: "FC_SELF_LINK", message: "Not sent — that's the shared Totem test account. A persona never interacts with it on Farcaster." };
  }
  // another of the owner's own accounts, by persona (the attribution index, a local copy) or by its fid's record
  let other = authorPersonaId && authorPersonaId !== d.personaId && isViewerPersona(authorPersonaId) ? authorPersonaId : null;
  if (!other && authorFid !== null && authorFid !== d.fid) {
    const owner = await personaOfFid(authorFid); // THROWS on an unreadable vault: the caller refuses
    if (owner && owner !== d.personaId) other = owner;
  }
  if (other) {
    // Act as... shows the A-FID-SELF-GRAPH waiver where it is used; main is never covered by it, from either side
    const mainInvolved = actorIsMain || main.personaIds.has(other);
    if (!opts.siblingsAllowed || mainInvolved) {
      const name = handleOf(other);
      const who = name ? "@" + name : "one of your other accounts";
      return {
        verdict: "refuse",
        status: 403,
        code: "FC_SELF_LINK",
        // UXC-08: main and another account never interact — no "Use Act as…" (Act as… refuses that pair too)
        message: mainInvolved
          ? `Not sent — that's ${who}, ${main.personaIds.has(other) ? "your main account" : "one of your other accounts"}. ${MAIN_APART}`
          : `Not sent — that's ${who}, another of your accounts. Doing this from ${farcasterName(d)} on Farcaster would publicly link the two accounts.${opts.siblingsAllowed ? "" : " Use Act as… on the post if you mean to."}`,
      };
    }
  }
  // PUB-8 / PL-2: the owner's accounts no persona record names — the anonymous account and the fids Totem set aside
  // (FC_RESERVED_FIDS); a persona's own record was judged just above (Act as…'s waiver included). THROWS while the
  // anonymous account cannot be named (the live ZK universe is on and its settings are unread): the caller refuses
  // rather than guess
  const records = authorFid !== null && authorFid !== d.fid && !authorIsMain && !other ? await allPersonaFids() : null;
  if (records && authorFid !== null && !records.some((r) => r.fid === authorFid)) {
    const own = await ownAccountFidsWithAnon(records);
    if (own.has(authorFid)) {
      return {
        verdict: "refuse",
        status: 403,
        code: "FC_SELF_LINK",
        message: `Not sent — fid ${authorFid} is one of your own accounts (the anonymous account, or one Totem set aside). Doing this from ${farcasterName(d)} on Farcaster would publicly link them.${
          actorIsMain ? " " + MAIN_APART : ""
        }`,
      };
    }
  }
  return { verdict: "farcaster", authorPersonaId, authorFid };
}

/**
 * Is `hash` a cast on the network this delivery writes to, and may this persona act on it there? Reads the
 * attribution index, so the caller has hydrated the store. `authorFid` is the card's own author fid (a hint the UI
 * has for free; it can only ever cause a refusal). `probe` skips the live author lookup (the Composer's pre-post
 * line: no credits for a page view; the post itself runs the full check).
 */
export async function classifyTarget(
  hash: string,
  d: FarcasterDelivery,
  opts: { authorFid?: number | null; siblingsAllowed?: boolean; probe?: boolean } = {}
): Promise<TargetVerdict> {
  const hint = typeof opts.authorFid === "number" && Number.isInteger(opts.authorFid) && opts.authorFid > 0 ? opts.authorFid : null;
  if (d.mode === "fixture") {
    const sim = fcSimNetworkCasts().find((c) => c.hash === hash);
    if (!sim) return { verdict: "layers", reason: "target_local" };
    const attributed = state().fcAttribution.get(hash)?.personaId ?? null;
    // PUB-7: a sim cast with no fid went out under the SHARED account (a persona without its own) — whoever it is
    // attributed to, the account on the network is the shared one
    if (sim.fid === undefined) return { verdict: "refuse", status: 403, code: "FC_SELF_LINK", message: "Not sent — that post went out under the shared Totem test account. A persona never interacts with it on Farcaster." };
    return guardAuthor(d, attributed, sim.fid ?? hint, opts);
  }
  if (!isNetworkHashShape(hash)) return { verdict: "layers", reason: "target_local" };
  const attributed = state().fcAttribution.get(hash)?.personaId ?? null;
  const copy = await localCopy(hash);
  const known = !!attributed || !!copy;
  if (!known) {
    // a stranger's cast, unless a local store holds it — on this service that is the anon list. isNetworkCastTarget
    // reads every store and THROWS when one is unreadable: unknown locality is refused by the caller, never guessed
    if (!(await isNetworkCastTarget(hash))) return { verdict: "layers", reason: "target_anon" };
  }
  // PUB-3 / PL-1: an interaction on the real network while main is unknown is refused BEFORE any author lookup — no
  // credits spent on something that cannot go out (guardAuthor says the same for follows and as a second line)
  if ((await mainAccount()).fids.size === 0) return { verdict: "refuse", status: 409, code: "FC_MAIN_UNKNOWN", message: "Not sent — " + MAIN_UNKNOWN_SENTENCE };
  // PUB-7: a cast Totem knows (attributed, or copied here) is checked by the ACCOUNT it went out under too — the card's
  // author fid, else its ledgered publish (the shared test account's, for a persona that posted before it had its own),
  // else its local copy's author, else (not a probe) the network. The persona it is attributed to says nothing about
  // which account published it.
  let authorFid = hint ?? (known ? publishedFid(hash) ?? copy?.fid ?? null : null);
  if (authorFid === null && !opts.probe) {
    authorFid = await liveAuthorFid(hash); // THROWS when the lookup fails: refused by the caller
    if (authorFid === null && !known) return { verdict: "layers", reason: "target_local" }; // the network has no such cast
  }
  return guardAuthor(d, attributed ?? copy?.personaId ?? null, authorFid, opts);
}

/** May this persona follow `targetFid` on Farcaster? (never itself, never another own account, never main) */
export async function followVerdict(targetFid: number, d: FarcasterDelivery): Promise<TargetVerdict> {
  if (targetFid === d.fid) return { verdict: "refuse", status: 409, code: "FC_SELF_FOLLOW", message: `Not followed — that's @${d.handle}'s own account.` };
  return guardAuthor(d, null, targetFid, { siblingsAllowed: false });
}

// ------------------------------------------------------------------------------------------- the ledger and attribution

/** did THIS account already send this like / recast / follow through the door (sent, same network)? */
export function sentBefore(kind: "like" | "recast" | "follow", d: FarcasterDelivery, target: { castHash?: string; targetFid?: number }): boolean {
  return fcWrites().some(
    (e) =>
      e.kind === kind &&
      e.fid === d.fid &&
      e.mode === d.mode &&
      e.status === "sent" &&
      (kind === "follow" ? e.targetFid === target.targetFid : e.castHash === target.castHash)
  );
}

/** BUILD A review (PUB-6): is THIS account's like / recast of the cast still on its way (a pending ledger entry — sent
 *  a moment ago and not answered yet, or answered ambiguously)? An un-like then must not say "nothing changed". */
export function pendingBefore(kind: "like" | "recast", d: FarcasterDelivery, castHash: string): boolean {
  return fcWrites().some((e) => e.kind === kind && e.fid === d.fid && e.mode === d.mode && e.status === "pending" && e.castHash === castHash);
}

/**
 * Attribution is a fact about a publish, FIRST WRITER WINS — the same rule as the /api/fc/write door: a deduped
 * publish never re-attributes an existing row; a deduped one with NO row is the ambiguous-failure retry finishing its
 * own publish. Signed by the persona it names (lib/fc/attribution.ts verifies before rendering).
 */
export async function recordAttribution(hash: string, personaId: string, deduped: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = state().fcAttribution.get(hash);
  if (deduped && existing) return { ok: true };
  const at = Date.now();
  const signature = signForPersona(personaId, attributionCanonical(hash, personaId, at));
  if (!signature) return { ok: false, error: "Totem couldn't sign which persona this was posted as" };
  state().fcAttribution.set(hash, { personaId, at, signature });
  await persistNs("fcAttribution");
  return { ok: true };
}

// ------------------------------------------------------------------------------------------- answers

const UNCONFIRMED_HINT: Record<Verb, string> = {
  cast: "If it reached Farcaster, posting the same text again finds it instead of posting it twice.",
  reply: "If it reached Farcaster, sending the same reply again finds it instead of posting it twice.",
  like: "It may have gone through. Liking again is safe: Farcaster keeps one like per account.",
  recast: "It may have gone through. Recasting again is safe: Farcaster keeps one recast per account.",
  follow: "It may have gone through. Following again is safe: Farcaster keeps one follow per account.",
  quote: "It may have gone through.",
};

/** the identity rule's and the guards' refusals: the self-link guard (403 FC_SELF_LINK), "main is not known yet" (409
 *  FC_MAIN_UNKNOWN — a setting fixes it), anything else the identity rule refused (403 FC_IDENTITY) */
function identityResponse(e: FcIdentityError): NextResponse {
  if ((e as { mainUnknown?: boolean }).mainUnknown === true) return NextResponse.json({ error: e.message, code: "FC_MAIN_UNKNOWN" }, { status: 409 });
  const selfLink = (e as { selfLink?: boolean }).selfLink === true;
  return NextResponse.json({ error: e.message, code: selfLink ? "FC_SELF_LINK" : "FC_IDENTITY" }, { status: 403 });
}

const REFUSED_NOUN: Record<Verb, [string, string]> = {
  cast: ["post", "posted"],
  reply: ["reply", "posted"],
  like: ["like", "sent"],
  recast: ["recast", "sent"],
  follow: ["follow", "sent"],
  quote: ["quote", "posted"],
};

/**
 * a write-door failure, answered exactly (BUILD A review, PUB-2 / UXC-03 — one code per kind of outcome, so the
 * Composer never tells the owner something "may have gone through" when Farcaster plainly said no):
 *   429 FC_CAP                a daily cap (shared by every account; the sentence says which setting raises it)
 *   403/409                   the identity rule or a guard (identityResponse)
 *   502 FC_REFUSED            Farcaster ANSWERED no (a revoked signer, a rejected text, credits): nothing happened,
 *                             the ledger entry is settled failed and holds no slot
 *   409 FC_RETRY_UNCONFIRMED  an earlier attempt of these words has an unknown outcome and cannot be seen: not sent
 *   503 FC_RETRY_UNCHECKED    the earlier attempt could not be checked: not sent
 *   502 FC_UNCONFIRMED        the network did not answer this attempt (dropped, timed out, 5xx): it MAY have gone
 *                             through — only this one carries the "doing it again is safe" hint, and the pending
 *                             ledger entry is the receipt the next attempt checks
 */
export function writeErrorResponse(e: unknown, verb: Verb): NextResponse {
  if (e instanceof FcWriteCapError) return NextResponse.json({ error: e.message, cap: e.cap, code: "FC_CAP" }, { status: 429 });
  if (e instanceof FcIdentityError) return identityResponse(e);
  if (e instanceof FcRetryUnconfirmedError) return NextResponse.json({ error: e.message, code: "FC_RETRY_UNCONFIRMED" }, { status: 409 });
  if (e instanceof FcRetryCheckError) return NextResponse.json({ error: e.message, code: "FC_RETRY_UNCHECKED" }, { status: 503 });
  const msg = e instanceof Error ? e.message : String(e);
  if (isDefinitiveFailure(e)) {
    const [noun, done] = REFUSED_NOUN[verb];
    return NextResponse.json({ error: `Farcaster refused this ${noun} (${msg}) — nothing was ${done}.`, code: "FC_REFUSED", ambiguous: false }, { status: 502 });
  }
  return NextResponse.json({ error: msg, code: "FC_UNCONFIRMED", ambiguous: true, hint: UNCONFIRMED_HINT[verb] }, { status: 502 });
}

/** a check that could not be made (the account record, a target's author): nothing was sent */
export function uncheckedResponse(e: unknown, what: string): NextResponse {
  if (e instanceof FcIdentityError) return identityResponse(e);
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: `Couldn't check ${what} (${msg}) — nothing was sent. Try again.`, code: "FC_UNCHECKED" }, { status: 503 });
}

// ------------------------------------------------------------------------------------------- 3. still what was shown?

/** what the Composer showed before the click, sent back with the post */
export interface DeliveryExpectation {
  to: "farcaster" | "layers";
  personaId: string | null;
  fid: number | null;
}

/** the `expect` field of a post, or null when absent or malformed (a malformed one is never trusted as a match) */
export function parseExpectation(v: unknown): DeliveryExpectation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.to !== "farcaster" && o.to !== "layers") return null;
  const personaId = typeof o.personaId === "string" && o.personaId ? o.personaId : null;
  const fid = typeof o.fid === "number" && Number.isInteger(o.fid) && o.fid > 0 ? o.fid : null;
  return { to: o.to, personaId, fid };
}

/**
 * BUILD A review (PUB-1) — has where this post goes changed since the line under the box was shown? The answer at
 * request time is the one that counts (the acting-persona cookie is shared by every tab; an account can be created
 * while a tab is open), so the line the owner saw is compared with it:
 *   - a FARCASTER post must have been shown as one, for the same persona and the same account; on the real network a
 *     post with no expectation at all is refused too (a public, permanent post nobody was shown). The simulated
 *     network (the rig's knob) accepts a caller that sends none — it reaches no one;
 *   - a post shown as going to Farcaster that would now stay in Totem is refused as well (the owner meant it public).
 *   - Totem-only both ways passes: nothing public happens.
 * null = unchanged; otherwise the reason.
 */
export function deliveryChanged(expect: DeliveryExpectation | null, fresh: FcDelivery): string | null {
  if (isFarcaster(fresh)) {
    if (!expect) return fresh.mode === "live" ? "no line was shown before this post" : null;
    if (expect.to !== "farcaster") return "the line said it would stay in Totem";
    if (expect.personaId !== fresh.personaId) return "the line named another persona";
    if (expect.fid !== fresh.fid) return "the line named another Farcaster account";
    return null;
  }
  if (expect && expect.to === "farcaster") return "the line said it would go to Farcaster";
  return null;
}

/** the line under the box for this answer — the same words GET /api/actions/delivery shows (a reply's own wording) */
export function lineFor(d: FcDelivery, isReply: boolean): FcDelivery {
  if (!isReply) return d;
  if (isFarcaster(d)) return { ...d, message: `Replies go to ${networkName(d.mode)} as ${farcasterName(d)} — public` };
  if (d.reason === "target_local") return { ...d, message: "Replies to this post stay in Totem — it isn't on Farcaster" };
  return d;
}

/** BUILD A review (PUB-1): the 409 for a post whose destination changed after its line was shown — nothing was posted,
 *  and the fresh line rides along so the Composer can show it before the next click */
export function deliveryChangedResponse(why: string, fresh: FcDelivery): NextResponse {
  return NextResponse.json(
    {
      error: `Not posted — where this goes changed since the line under the box was shown (${why}). It now says: ${fresh.message}. Check it, then press Post again.`,
      code: "FC_DELIVERY_CHANGED",
      delivery: fresh,
    },
    { status: 409 }
  );
}

/** BUILD A review (PUB-1): a like, recast or follow names the persona its card was rendered for; refused when that is
 *  not the acting persona now (another tab switched it). Absent = a caller that predates this (no comparison). */
export function personaChangedResponse(sent: unknown, acting: string): NextResponse | null {
  if (typeof sent !== "string" || !sent || sent === acting) return null;
  const now = handleOf(acting);
  return NextResponse.json(
    {
      error: `Not sent — you switched persona${now ? " to @" + now : ""} in another tab or window since this page loaded. Reload this page, then try again as the persona you mean.`,
      code: "FC_PERSONA_CHANGED",
    },
    { status: 409 }
  );
}
