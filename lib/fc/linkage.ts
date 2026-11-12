import "server-only";
// MULTI-FID PASS Gate 1 — the REGISTRANT-LINKAGE assertion (safety set).
// Two persona fids of one root must share NO user-attributable onchain
// registrant, funder or custody address: a common registrant or funder
// that is not a shared sponsor links the accounts on a public chain forever,
// before any proof machinery gets a say.
//
// CONNECT MAIN research (chain read 2026-10-07) — the header this file carried ("Neynar sponsorship satisfies it:
// Neynar is the registrant and funder for everyone") is REFUTED ONCHAIN. The IdGateway.register sender of a
// Neynar-sponsored account is the DEVELOPER's own Neynar App Wallet (for this owner: the wallet that registered the
// Totem-named test account and the seven fids pre-registered beside it in one burst), which is developer-unique,
// not a shared sponsor. What IS shared across every Neynar-registered account is the signer request fid 6131
// (@neynar) and the recovery proxy, and those fingerprint nobody. So two personas drawn from one App Wallet ARE
// linked by their sender (and by fid adjacency to the test account) whatever this assertion says: the acquisition
// records still carry registrant/funder "neynar-sponsor" BY FIAT (A-FID-REGISTRANT-BY-FIAT — the command never
// reads the chain's sender), and the SPONSOR_IDS exemption below keeps that fiat value from flagging every pair.
// The honest answer lives where the money is spent: scripts/owner/acquire-fid.ps1 and scripts/fid-acquire.mjs
// state the sibling link before the dry run and make the owner type SIBLINGS (the current wallet) or FRESH (a
// wallet that never touched the test account). A chain read of the Register event stays the linkage test's
// (Gate 5) job, not this assertion's.
//
// A "connected" record (the owner's own main account, lib/fc/connect.ts) carries registrant/funder "owner": that
// is user-attributable by definition and is NOT exempt — if it ever shared a value with a persona record, that is
// a finding. Its connector (the onchain requestFid C, the fid whose custody signed main's SignedKeyRequest) is the
// one app fid main uses and nothing else uses: a persona whose signer was requested by C would publish the
// main ↔ persona link in the KeyRegistry, so requestFids are grouped too (kind "requestFid"), with the shared
// request fids exempt (6131 @neynar for every Neynar-managed signer; 9152 @warpcast for the Farcaster app).
//
// Fixture: the acquisition records carry the registrant/funder the fixture
// stand-in reports. Live: the same fields, filled from the creation
// receipt; a chain read of the IdRegistry Register event is the linkage
// test's (Gate 5) job, not this assertion's.
import type { PersonaFidRecord } from "./personaFid";

/** identities that mean "created through the sponsored path" — recorded by fiat, never a chain fact (see above) */
export const SPONSOR_IDS: ReadonlySet<string> = new Set(["neynar-sponsor", "neynar"]);

/** CONNECT MAIN: signer request fids shared by every account of their kind — they fingerprint nobody:
 *  6131 (@neynar) requests every Neynar-managed signer; 9152 (@warpcast) is the Farcaster app's own */
export const SHARED_REQUEST_FIDS: ReadonlySet<number> = new Set([6131, 9152]);

export interface LinkageFinding {
  kind: "registrant" | "funder" | "custody" | "requestFid";
  value: string;
  fids: number[];
}

/** the fid that requested a record's signer key onchain, as far as the record knows it: a "connected" record's
 *  connector (read back from the chain at connect time); a persona record's decoded requestFid once the F22
 *  pre-check stores one (the field is not declared on PersonaFidRecord yet — read defensively, never assumed) */
function requestFidOf(r: PersonaFidRecord): number | null {
  const c = r.connected?.requestFid;
  if (typeof c === "number" && Number.isInteger(c) && c > 0) return c;
  const v = (r as unknown as { requestFid?: unknown }).requestFid;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export function registrantLinkage(records: PersonaFidRecord[]): { ok: boolean; findings: LinkageFinding[] } {
  const findings: LinkageFinding[] = [];
  const groupBy = (kind: LinkageFinding["kind"], pick: (r: PersonaFidRecord) => string) => {
    const m = new Map<string, number[]>();
    for (const r of records) {
      const v = pick(r).toLowerCase();
      if (!v) continue;
      if ((kind === "registrant" || kind === "funder") && SPONSOR_IDS.has(v)) continue;
      m.set(v, [...(m.get(v) ?? []), r.fid]);
    }
    for (const [value, fids] of m) if (fids.length > 1) findings.push({ kind, value, fids });
  };
  groupBy("registrant", (r) => r.registrant);
  groupBy("funder", (r) => r.funder);
  groupBy("custody", (r) => r.custodyAddress);
  groupBy("requestFid", (r) => {
    const f = requestFidOf(r);
    return f !== null && !SHARED_REQUEST_FIDS.has(f) ? String(f) : "";
  });
  return { ok: findings.length === 0, findings };
}
