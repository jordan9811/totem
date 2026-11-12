import "server-only";
// MULTI-FID PASS Gate 1 — FID ACQUISITION per persona, the fixture half.
//
// Money rules (the prompt's, not negotiable): hard cap $10 real spend for
// the whole pass, at most TWO persona fids created live, a dry-run cost
// sheet before any creation, everything through the spend ledger, mode-
// scoped, itemized to the cent. The LIVE creation is the user's command
// (scripts/fid-acquire.mjs): it prints this cost sheet, refuses above the
// cap, creates through Neynar sponsorship (Neynar is the registrant and
// funder for everyone — the registrant-linkage rule holds by construction)
// and hands the record to the app, which seals it into the vault. The app
// itself never creates a live account and never spends.
//
// Fixture: a deterministic fid (9,000,000 + n), the persona's handle as
// its fname, a custody address derived from the root (recoverable), a
// simulated signer from the configured custody adapter, a $0.00 ledger
// entry that names the live estimate.
import { personaById } from "@/lib/adapters/mock/store";
import { getPersona } from "@/lib/identity/keystore";
import { fcCustodyAddressFor, fcSignerPublicKeyFor, isKeystoreRootedPersona, isViewerPersona } from "@/lib/identity/keys";
import { kindOf } from "@/lib/identity/personaKind";
import { FID_SPEND_CAP_USD, boundedEnvNumber, fidSpentLive, recordFidSpend } from "@/lib/x/spend";
import { custody } from "./custody/source";
import { allPersonaFids, mainNameDerivation, nextFixtureFid, personaFidRecord, recordPersonaFid, type PersonaFidRecord } from "./personaFid";

export { FID_SPEND_CAP_USD };
/** PROD-LIVE (D-PRODLIVE-OWNER-SERVICE, caps): the most live persona accounts any override can allow */
export const MAX_LIVE_PERSONA_FIDS_HARD_MAX = 20;
/** Two by default, as the multi-FID prompt set it. The owner may raise it with LAYERS_MAX_LIVE_PERSONA_FIDS (a whole
 *  number, clamped to MAX_LIVE_PERSONA_FIDS_HARD_MAX; anything unparseable stays 2) — on the app AND in the
 *  acquisition command's own environment, which enforces the same bound before any billable call. */
export const MAX_LIVE_PERSONA_FIDS = boundedEnvNumber(process.env.LAYERS_MAX_LIVE_PERSONA_FIDS, 2, MAX_LIVE_PERSONA_FIDS_HARD_MAX, { integer: true });
/** the FC pass measured ~$0.35–$0.90 of ETH billed per sponsored registration; the sheet assumes the top of that range.
 *  PROD-LIVE (caps): the estimate may be RAISED (prices move) but never set below that measured top — an estimate of 0
 *  ledgered every registration at $0.00, so the dollar cap could never bind and only the account count limited spend. */
export const FID_CREATE_USD_ESTIMATE = boundedEnvNumber(process.env.FID_CREATE_USD_ESTIMATE, 0.9, 10, { floor: 0.9 });
/** Neynar compute credits per call (billed against the plan's allowance, not USD) */
const CREDITS = { fnameCheck: 1, signer: 2, register: null as number | null };

/** the protocol's fname grammar (farcaster/core) */
export const FNAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;

export function fnameFromHandle(handle: string): string {
  const s = handle
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 16)
    .replace(/-+$/, "");
  // MULTI-FID Gate 5 (attack-fid-1 #4): a fallback fname never names the client
  return FNAME_RE.test(s) ? s : "u" + Math.abs(hash32(handle)).toString(36).slice(0, 10);
}
function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export interface CostRow {
  item: string;
  usd: number | null;
  credits: number | null;
  source: string;
}

export function costSheet(personas: number): { rows: CostRow[]; totalUsd: number; capUsd: number; underCap: boolean; established: boolean; spentSoFar: number } {
  const rows: CostRow[] = [];
  for (let i = 1; i <= personas; i++) {
    rows.push({ item: `persona ${i}: fname availability`, usd: 0, credits: CREDITS.fnameCheck, source: "docs.neynar.com reference/compute-units" });
    rows.push({ item: `persona ${i}: managed signer`, usd: 0, credits: CREDITS.signer, source: "docs.neynar.com reference/compute-units" });
    rows.push({ item: `persona ${i}: sponsored registration (ETH billed to the app wallet)`, usd: FID_CREATE_USD_ESTIMATE, credits: CREDITS.register, source: "REPORT-FC Gate 1: ~$0.35–$0.90 measured; top of range assumed" });
  }
  const totalUsd = Math.round(rows.reduce((a, r) => a + (r.usd ?? 0), 0) * 100) / 100;
  const spentSoFar = fidSpentLive();
  return {
    rows,
    totalUsd,
    capUsd: FID_SPEND_CAP_USD,
    spentSoFar,
    underCap: spentSoFar + totalUsd <= FID_SPEND_CAP_USD,
    established: rows.every((r) => r.usd !== null),
  };
}

export interface AcquireRefusal {
  refused: true;
  reason: string;
}

function handleOf(personaId: string): string {
  const minted = getPersona(personaId);
  if (minted) return minted.handle;
  const seeded = personaById.get(personaId);
  return seeded?.handle ?? personaId;
}

/** FIXTURE acquisition: mints a deterministic fid for one of this root's PUBLIC personas */
export async function acquireFixtureFid(personaId: string): Promise<PersonaFidRecord | AcquireRefusal> {
  // the kind first: a private persona is refused as PRIVATE whoever holds it (the network never learns it exists)
  if (kindOf(personaId) === "private") return { refused: true, reason: "private personas never get a fid — they never touch the network" };
  if (!isViewerPersona(personaId)) return { refused: true, reason: "not one of this root's personas — a fid is acquired only for a persona this device holds" };
  if (kindOf(personaId) !== "public") return { refused: true, reason: "only a persona known to be public gets a fid (unknown is refused, fail closed)" };
  if (await personaFidRecord(personaId)) return { refused: true, reason: "this persona already owns a fid — one persona, one fid" };
  const derivedPubHex = fcSignerPublicKeyFor(personaId);
  const custodyAddress = fcCustodyAddressFor(personaId);
  if (!derivedPubHex || !custodyAddress) return { refused: true, reason: "the persona's signer and custody keys could not be derived" };
  const fid = await nextFixtureFid();
  const signer = await custody().provision({ personaId, fid, derivedPubHex, mode: "fixture" });
  const rec: PersonaFidRecord = {
    personaId,
    fid,
    fname: fnameFromHandle(handleOf(personaId)),
    origin: "fixture",
    custodyAddress,
    signer,
    registrant: "neynar-sponsor",
    funder: "neynar-sponsor",
    createdAt: Date.now(),
    mode: "fixture",
  };
  await recordPersonaFid(rec);
  await recordFidSpend(
    { id: `fid:create:${fid}`, kind: "fid_create", amount: 0, note: `fixture acquisition for a persona (no spend; live estimate $${FID_CREATE_USD_ESTIMATE.toFixed(2)})` },
    "fixture"
  );
  return rec;
}

/** the record a LIVE acquisition (the user's command) hands the app — validated, then sealed */
export async function recordLiveFid(input: PersonaFidRecord): Promise<PersonaFidRecord | AcquireRefusal> {
  if (input.mode !== "live" || input.origin !== "layers-fid-pass") return { refused: true, reason: "a live record must come from this pass's own acquisition path (origin layers-fid-pass)" };
  if (!isViewerPersona(input.personaId)) return { refused: true, reason: "not one of this root's personas" };
  // MULTI-FID Gate 5 (D-FID-5-LIVE-KEYSTORE-ONLY): a LIVE account only for a persona whose keys come off the root phrase
  if (!isKeystoreRootedPersona(input.personaId)) return { refused: true, reason: "a live fid may only be recorded for a persona whose keys come off the root phrase — a seeded persona's keys are public by construction; fork or mint a persona first" };
  if (kindOf(input.personaId) !== "public") return { refused: true, reason: "private personas never get a fid" };
  if (!Number.isInteger(input.fid) || input.fid <= 0) return { refused: true, reason: "fid malformed" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.custodyAddress)) return { refused: true, reason: "custody address malformed" };
  // CONNECT MAIN review: the cap counts accounts this pass CREATED. A "connected" record is the owner's existing main
  // account (never created, never paid for), so it does not eat a persona slot — counting it would refuse the second
  // persona on a service where main is connected. scripts/fid-acquire.mjs applies the same filter before its first call.
  const live = (await allPersonaFids()).filter((r) => r.mode === "live" && r.origin !== "connected");
  if (live.length >= MAX_LIVE_PERSONA_FIDS) return { refused: true, reason: `at most ${MAX_LIVE_PERSONA_FIDS} persona fids may be created live in this pass (LAYERS_MAX_LIVE_PERSONA_FIDS raises it, up to ${MAX_LIVE_PERSONA_FIDS_HARD_MAX})` };
  const derived = fcSignerPublicKeyFor(input.personaId);
  if (!derived || input.signer.derivedPubHex !== derived) return { refused: true, reason: "the record's derived signer key is not this persona's — refused" };
  const custodyAddr = fcCustodyAddressFor(input.personaId);
  if (!custodyAddr || custodyAddr.toLowerCase() !== input.custodyAddress.toLowerCase()) return { refused: true, reason: "the record's custody address is not the one derived for this persona — refused" };
  // CONNECT MAIN review (PL-4): an account named after the connected main account is never recorded as a persona's (the
  // acquisition command is refused at its probe, before anything is spent; this is the record's own check)
  const stem = (await mainNameDerivation(handleOf(input.personaId))) ?? (input.fname ? await mainNameDerivation(input.fname) : null);
  if (stem) return { refused: true, reason: stem };
  await recordPersonaFid({ ...input, createdAt: input.createdAt || Date.now() });
  return input;
}
