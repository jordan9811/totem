import "server-only";
// MULTI-FID PASS Gate 1 — THE PERSONA ↔ FID MAP.
//
// Root → persona → fid is a VAULT fact: the full record (fid, fname,
// custody address, the signer reference — a Neynar signer uuid is a
// secret —, who registered and who paid) lives in ONE sealed, padded
// record in the vault namespace "personaFids", exactly like the
// attestation record. The validator learns ONLY { personaId → fid, fname }
// through the PLAIN namespace "personaFidMap", which is what attribution
// rendering needs and nothing more: a public persona's own public account
// is not a secret; which ROOT holds the persona is, and it never leaves
// the vault.
//
// Private personas never get a fid (they never touch the network).
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import { derivedFromMain } from "@/lib/identity/handleStem";
import type { SignerRef } from "./custody/types";

export const VAULT_NS = "personaFids";
export const MAP_NS = "personaFidMap";

/** CONNECT MAIN (lib/fc/connect.ts): "connected" is the owner's OWN existing Farcaster account, approved by QR in the
 * Farcaster app — the one origin Totem did not create. Its custody stays in the owner's Farcaster app (never derived,
 * never held here), so the identity rule admits it through its own branch (lib/fc/writes.ts connectedCreds), never
 * through the derivation-equality check the other own origins pass. */
/** PERSONA LAUNCH P6: "layers-launch" is a persona's account the LAYERS REGISTRAR created for it (lib/launch/*): custody
 * and recovery are the persona's own derived keys, its signer is the persona's own derived key registered on the account
 * (self-custody), and it was paid for by the registrar — never the user's wallet. ownAccountFids includes it (it is not
 * "connected"), so the self-link guard keeps main apart from it. Such a record is never STORED in this namespace: it is
 * read from the persona's sealed launch record (fix LP-1, launchedAccounts below). */
export type FidOrigin = "fixture" | "layers-fid-pass" | "throwaway" | "connected" | "layers-launch";

/** PERSONA LAUNCH P6 — what a launched account's record also keeps (sealed with it; nothing here is a secret) */
export interface LaunchFacts {
  /** the commitment the anonymous launch request was proved under */
  launchCommit: string;
  /** the account's recovery address (the persona's own derived recovery key, kdf fc-recovery/<nonce>) */
  recoveryAddress: string;
  /** the registration's hour on the registrar's clock (public: the chain shows it) */
  registeredHour: number;
  /** SIMULATED: the registrar and its chain are the fixture this wave — never presented as a live account */
  simulated: true;
}

/** CONNECT MAIN — the facts that make a "connected" record the owner's main account. Present on that origin only;
 * nothing here is a secret (the signer uuid stays in `signer`, which every surface redacts). */
export interface ConnectedFacts {
  /** the persona IS the owner's public self — the account the self-link guard keeps apart from every other one */
  publicSelf: true;
  /** the connector fid whose custody signed the key request: the onchain requestFid, read back from the chain */
  requestFid: number;
  /** custodyOf(requestFid) when the key add was verified — the onchain requestSigner */
  requestSigner: string;
  /** the Neynar-generated Ed25519 key main approved (0x + 64 hex; public, it is in main's KeyRegistry entry) */
  signerPublicKey: string;
  /** the KeyRegistry add, and who submitted it (Farcaster's shared relayer, never a Totem address) */
  keyAddTx: string | null;
  submittedBy: string | null;
  approvedAt: number;
  verifiedAt: number;
  /** set by a disconnect: the signer uuid is wiped and every write as main refuses, but the record stays — the
   * self-link guard keeps main apart from the personas whether or not Totem can still post as it */
  disconnectedAt?: number | null;
  /** CONNECT MAIN review (UXC-02): WHY it is disconnected — the owner pressed Disconnect here ("owner"), or Farcaster
   * reported the key revoked (the owner removed Totem in the Farcaster app's connected apps: "revoked_in_app") */
  disconnectReason?: "owner" | "revoked_in_app" | null;
}

export interface PersonaFidRecord {
  personaId: string;
  fid: number;
  fname: string | null;
  /** which path created the account — the identity rule admits only accounts THIS pass created (and, through its own
   * branch, the owner's connected main account) */
  origin: FidOrigin;
  /** the fid's custody address (derived per persona from the root; the key itself is never stored). For a
   * "connected" record: main's custody as Neynar reported it — the owner's Farcaster app holds that key, never us */
  custodyAddress: string;
  signer: SignerRef;
  /** who registered the fid onchain (the sponsor for Neynar-sponsored creation) and who paid ("owner" when connected) */
  registrant: string;
  funder: string;
  createdAt: number;
  mode: "fixture" | "live";
  /** CONNECT MAIN: only on origin "connected" */
  connected?: ConnectedFacts;
  /** PERSONA LAUNCH P6: only on origin "layers-launch" */
  launch?: LaunchFacts;
}

/** CONNECT MAIN — where one in-flight connection stands. Sealed beside the records (the signer uuid is a secret).
 * "refused": approved in the Farcaster app, but what the chain (or the record's own checks) showed was not what was
 * asked for — nothing was recorded, and the owner removes the stray connection in the app before starting again. */
export type ConnectStage = "pending_approval" | "approved" | "wrong_account" | "revoked" | "expired" | "refused";

export interface ConnectSession {
  /** random; the page's handle for poll / finish / cancel */
  id: string;
  mode: "fixture" | "live";
  stage: ConnectStage;
  /** main, as the owner named it and the network resolved it */
  expectedFid: number;
  expectedUsername: string;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
  custodyAddress: string;
  /** the connector fid (the requestFid) and its custody address */
  appFid: number;
  appCustody: string;
  appUsername: string | null;
  /** SECRET — Neynar's managed-signer handle: this sealed record only, never a response, never a log */
  signerUuid: string;
  signerPublicKey: string;
  /** the approval request's token (the QR): kept sealed, shown only to the owner while the request is pending */
  approvalToken: string;
  approvalUrl: string;
  /** unix seconds — the SignedKeyRequest deadline; the request is dead after it */
  deadline: number;
  sponsored: boolean;
  createdAt: number;
  /** what the network reported at the approving poll */
  approvedFid: number | null;
  approvedAt: number | null;
  /** the keystore persona minted for main (finish), once minted — a retried finish resumes with it */
  personaId: string | null;
  /** the honest one-line reason a session stopped (wrong account, revoked, expired) */
  note: string | null;
}

interface Doc {
  items: PersonaFidRecord[];
  /** fixture fid counter (deterministic ids across a reset) */
  nextFixtureFid: number;
  /** CONNECT MAIN: the one in-flight connection, or none */
  connect?: ConnectSession | null;
  /** MULTI-FID Gate 5 (attack-fid-3 #6): true only for a document that came from a successful validator read — the
   * only kind save() will ever seal over the validator's copy */
  loaded?: boolean;
}

const FIXTURE_FID_BASE = 9_000_000;
const g = globalThis as unknown as { __layersPersonaFids?: Doc };

async function load(): Promise<Doc> {
  if (g.__layersPersonaFids) return g.__layersPersonaFids;
  // MULTI-FID Gate 5 (attack-fid-3 #6): a failed read is a REFUSAL, never an empty record set — an empty doc cached
  // here would count zero live fids, route a persona with a real account through the throwaway, and be sealed over
  // the validator's copy by the next save. Retried like every adapter read; the wrong-key throw stays loud.
  let doc: Doc = { items: [], nextFixtureFid: FIXTURE_FID_BASE, loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) { doc.loaded = true; break; } // the namespace does not exist yet: genuinely empty
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries); // throws on the wrong key: loud, never empty-as-success
        const rec = plain["_"] as { m?: Doc } | undefined;
        // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
        // namespace whose records are all unreadable — deleted, truncated, plaintext, or
        // sealed under a different key — became an EMPTY document marked loaded, and the next
        // write sealed that emptiness over the real record. Records present with none readable
        // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
        if (!rec)
          throw new Error(
            "vault: personaFids holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        if (rec && rec.m && Array.isArray(rec.m.items))
          doc = { items: rec.m.items, nextFixtureFid: rec.m.nextFixtureFid ?? FIXTURE_FID_BASE, connect: rec.m.connect ?? null, loaded: true };
        else doc.loaded = true;
      } else {
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break; // a wrong key is not transient
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!doc.loaded) throw new Error("persona↔fid records unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty");
  g.__layersPersonaFids = doc;
  return doc;
}

async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new Error("persona↔fid records were never loaded from the validator — refusing to seal over them");
  g.__layersPersonaFids = doc;
  const { loaded: _loaded, ...body } = doc;
  void _loaded;
  const inner = JSON.stringify(body);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: body, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  await flushVault(VAULT_NS, sealed);
  // MULTI-FID Gate 5 (attack-fid-1 #11, attack-fid-2 #1, attack-fid-3 #16): NO plain map on the validator. One
  // device-signed document listing every persona → fid of a root was the persona → root grouping migration 006
  // removed; nothing in the product ever read it (D-FID-5-MAP-SEALED). fid → persona resolves from the sealed record.
}

/** MULTI-FID Gate 5 (attack-fid-3 #2): the LIVE records survive a seed reset — a real account's signer lives nowhere else */
export async function liveFidRecordsSnapshot(): Promise<PersonaFidRecord[]> {
  return (await load()).items.filter((r) => r.mode === "live").map((r) => ({ ...r }));
}
export async function reseedAfterReset(liveItems: PersonaFidRecord[]): Promise<void> {
  const doc: Doc = { items: liveItems.map((r) => ({ ...r })), nextFixtureFid: FIXTURE_FID_BASE, loaded: true };
  await save(doc);
}

// ------------------------------------------------------------------------------------- PERSONA LAUNCH P6 (fix LP-1)
// THE LAUNCHED ACCOUNTS ARE READ FROM THEIR SEALED LAUNCH RECORD, NEVER WRITTEN HERE AT A LAUNCH STEP. The launch tick
// used to call recordPersonaFid the moment it noticed the registration (and setLaunchedFname right after the name
// server took the name): save() → flushVault — an IMMEDIATE device-signed PUT of this namespace under the root's anchor,
// lined up with a public registration (and a public fname) — the beacon "this device just launched an account" that the
// registrar's random 2–48 h batch exists to hide. Now the account's facts (fid, custody, recovery, signer, the accepted
// name) live only in the PENDING LAUNCH record of the sealed zkQueue (lib/zk/anon/queue.ts), persisted on that queue's
// own deferred random schedule like every other change to it, and padded to its coarse size class with everything else
// there; every reader below sees them through this MERGED view. recordPersonaFid REFUSES origin "layers-launch", so no
// launch path can write this namespace again. A store that cannot be read throws (never "no launched accounts": an
// account the guard does not know about would fail open — the self-link rule, the identity rule, ownAccountFids).

/** DELIBERATE DUPLICATE of lib/zk/anon/queue.ts LAUNCH_KIND (not imported: that module pulls the proof layer's transport
 *  into every route bundle this file ships in) — scripts/unit-launch.mjs pins the pair */
const LAUNCH_RECORD_KIND = "persona-launch-pending";

interface SealedLaunch {
  mode: "fixture" | "live";
  personaId: string;
  launchCommit: string;
  custody: string;
  recovery: string;
  signerKey: string;
  fid: number | null;
  registeredHour: number | null;
  fnameSet?: string | null;
}

/** every launched account this device holds a sealed launch record for (fid known: registered or later) */
async function launchedAccounts(): Promise<PersonaFidRecord[]> {
  const store = await import("@/lib/adapters/mock/store");
  await store.hydrate(); // an unreadable store THROWS: the caller refuses
  // the store builds its zkQueue map when it is created and hydrate fills it, so a state with NO map holds no sealed
  // record at all (a narrow stand-in store, as a harness keeps) — that is "no launched accounts", never a read failure;
  // a state that cannot be read at all (null) still throws below
  const queue = store.state().zkQueue as Map<string, unknown> | undefined;
  const out: PersonaFidRecord[] = [];
  if (!queue) return out;
  for (const q of queue.values() as IterableIterator<{ claimKind?: string }>) {
    const l = (q as { launch?: SealedLaunch }).launch;
    if (q.claimKind !== LAUNCH_RECORD_KIND || !l || typeof l.fid !== "number" || !Number.isInteger(l.fid) || l.fid <= 0) continue;
    out.push({
      personaId: l.personaId,
      fid: l.fid,
      fname: typeof l.fnameSet === "string" && l.fnameSet ? l.fnameSet : null,
      origin: "layers-launch",
      custodyAddress: l.custody,
      signer: { kind: "self-custody", derivedPubHex: l.signerKey, registered: true, simulated: true },
      registrant: "layers-registrar (simulated)",
      funder: "layers-registrar (simulated, $0)",
      createdAt: typeof l.registeredHour === "number" ? l.registeredHour * 3_600_000 : 0,
      mode: l.mode,
      launch: { launchCommit: l.launchCommit, recoveryAddress: l.recovery, registeredHour: typeof l.registeredHour === "number" ? l.registeredHour : 0, simulated: true },
    });
  }
  return out;
}

/** the vault's records PLUS the launched accounts (a vault record for the same persona or fid — one an older build wrote
 *  — wins, so nothing is listed twice) */
async function mergedItems(doc?: Doc): Promise<PersonaFidRecord[]> {
  const items = (doc ?? (await load())).items;
  const launched = (await launchedAccounts()).filter((l) => !items.some((x) => x.personaId === l.personaId || x.fid === l.fid));
  return [...items, ...launched];
}

export async function allPersonaFids(): Promise<PersonaFidRecord[]> {
  return (await mergedItems()).map((r) => ({ ...r }));
}

export async function personaFidRecord(personaId: string): Promise<PersonaFidRecord | null> {
  const r = (await mergedItems()).find((x) => x.personaId === personaId);
  return r ? { ...r } : null;
}

export async function personaOfFid(fid: number): Promise<string | null> {
  return (await mergedItems()).find((x) => x.fid === fid)?.personaId ?? null;
}

/** MULTI-FID PASS — the anoncast reveal pattern: the PUBLIC display facts for a fid this device
 * (or, on live, the real network) says is a persona's — used to render "revealed as @handle" on a
 * formerly-anon cast card. The persona may be keystore-minted or seeded; check both, like signerProbe. */
export interface RevealedProfile {
  fid: number;
  handle: string;
  name: string;
  avatarUrl: string | null;
  fname: string | null;
  /** PERSONA LAUNCH P6: HOW the reveal was checked — "chain": the signing key is a registered key of the fid on the
   *  (simulated) KeyRegistry, which anyone can check; "own-device": this device holds that persona's own record (the
   *  managed-signer case, checkable inside Totem only) */
  checkable: "own-device" | "chain";
  /** UX-L9: false only when the key was read from the real network's KeyRegistry (lib/types.ts Cast.attributedTo.chainSimulated) */
  chainSimulated?: boolean;
}

export async function publicProfileForFid(fid: number, attributedSigner: string | null): Promise<RevealedProfile | null> {
  // PERSONA LAUNCH P6 — THE CHAIN PATH, first: the attributed signer is an ACTIVE key the KeyRegistry lists for this fid
  // (fixture: the validator's simulated chain; live: refused, F25 — a claim it cannot check falls through to the
  // own-device rule, and from there to nothing). Then the account's public facts: its fname from the name server and
  // its profile from what its own key published through the thin relay. A row forged straight into the database with a
  // key the chain does not list fails here AND below: it renders as plain anon.
  const viaChain = await chainProfileForFid(fid, attributedSigner).catch(() => null);
  if (viaChain) return viaChain;
  // §14.2 — an attribution row is a CLAIM the validator carried, not a fact it established: anyone
  // holding a post's secret can ask for any fid to be written there. Rendering it as "@someone said
  // this" is the reader's own assertion, so the reader does the last check — is the key that signed
  // the claim actually a key of that fid? This client can answer that only for fids it registered
  // itself (a live key-registry lookup is the live-mode answer, F25). No answer, no attribution: the
  // card stays plain anon, which is what the cast has been all along. `attributedSigner` is REQUIRED
  // rather than optional so that skipping the check is a compile error, not a quiet default.
  const known = await ownFidSignerPublicKey(fid);
  if (!known || !attributedSigner || known.toLowerCase() !== attributedSigner.toLowerCase()) return null;
  const personaId = await personaOfFid(fid);
  if (!personaId) return null;
  const { getPersona } = await import("@/lib/identity/keystore");
  const { personaById } = await import("@/lib/adapters/mock/store");
  const p = getPersona(personaId) ?? personaById.get(personaId);
  if (!p) return null;
  // ANON REVIEW (R3-17): the reveal picker offers the account by its network fname; the revealed badge must name
  // the same account, so the fname rides along (null when the record has none — the card falls back to the handle)
  return { fid, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl ?? null, fname: (await personaFidRecord(personaId))?.fname ?? null, checkable: "own-device" };
}

/** PERSONA LAUNCH P6: the chain half of publicProfileForFid — null unless the key is a registered key of the fid now */
async function chainProfileForFid(fid: number, attributedSigner: string | null): Promise<RevealedProfile | null> {
  if (!Number.isInteger(fid) || fid <= 0 || !attributedSigner || !/^[0-9a-fA-F]{64}$/.test(attributedSigner)) return null;
  const { zkMode } = await import("@/lib/zk/config");
  const { chainSource } = await import("./chain/source");
  const { hasActiveKey } = await import("./chain/types");
  const chain = chainSource(zkMode()); // live: throws (F25) → the caller's catch → null
  const [account, keys] = await Promise.all([chain.account(fid), chain.keysOf(fid)]);
  if (!account || !hasActiveKey(keys, attributedSigner)) return null;
  // the profile the account's own key published through the thin relay — read from the relay's in-process table WITHOUT
  // importing lib/fc/thinRelay.ts (it lands casts through the write door, and this module is in every route bundle)
  const ud = (globalThis as unknown as { __layersThinRelay?: { userData?: Map<number, Partial<Record<"display" | "pfp" | "bio", string>>> } }).__layersThinRelay?.userData?.get(fid) ?? {};
  const fname = account.fname;
  return {
    fid,
    handle: fname ?? "fid" + fid,
    name: ud.display ?? fname ?? "fid " + fid,
    avatarUrl: ud.pfp && /^https:\/\//.test(ud.pfp) ? ud.pfp : null,
    fname,
    checkable: "chain",
    // PERSONA LAUNCH P6 (UX-L9): explicit — the live chain (wave 3) must set false itself, or the card keeps saying test data
    chainSimulated: zkMode() !== "live",
  };
}

/** the next deterministic fixture fid (9,000,000 + n) — never a live one */
export async function nextFixtureFid(): Promise<number> {
  const doc = await load();
  const fid = doc.nextFixtureFid;
  doc.nextFixtureFid = fid + 1;
  await save(doc);
  return fid;
}

export async function recordPersonaFid(rec: PersonaFidRecord): Promise<void> {
  // PERSONA LAUNCH P6 (fix LP-1): a launched account is never written here — its sealed launch record IS its record
  if (rec.origin === "layers-launch") throw new Error("a launched account's record lives in its sealed launch record — it is never written to personaFids (an immediate write at a launch step is a beacon)");
  const doc = await load();
  const all = await mergedItems(doc);
  if (all.some((x) => x.personaId === rec.personaId)) throw new Error("this persona already owns a fid — one persona, one fid");
  if (all.some((x) => x.fid === rec.fid)) throw new Error("this fid is already mapped to a persona — one fid, one persona");
  doc.items.push({ ...rec });
  await save(doc);
}

export async function forgetPersonaFids(mode?: "fixture" | "live"): Promise<void> {
  const doc = await load();
  // CONNECT MAIN: an in-flight connection of the forgotten mode goes with the records it would have produced
  const connect = doc.connect && mode && doc.connect.mode !== mode ? doc.connect : null;
  // the forgotten document is still the LOADED one (Gate 5: save() refuses a document that never came from the validator)
  await save({ items: doc.items.filter((x) => (mode ? x.mode !== mode : false)), nextFixtureFid: FIXTURE_FID_BASE, connect, loaded: doc.loaded });
}

/** resetSeed: the validator's copies were just wiped — the in-process record must not outlive them */
export function resetPersonaFidCache(): void {
  g.__layersPersonaFids = undefined;
}

/** the signer public key THIS client registered for a fid it owns, or null — the fid-facts live
 * adapter vouches for nothing else (neynar.score, D-FID-0-SIGNER-VOUCH) */
export async function ownFidSignerPublicKey(fid: number): Promise<string | null> {
  const r = (await mergedItems()).find((x) => x.fid === fid);
  if (!r) return null;
  return r.signer.derivedPubHex;
}

/** the plain map as the validator holds it — what any client may learn */
export async function personaFidMap(): Promise<Record<string, { fid: number; fname: string | null }>> {
  const out: Record<string, { fid: number; fname: string | null }> = {};
  for (const r of await mergedItems()) out[r.personaId] = { fid: r.fid, fname: r.fname };
  return out;
}

// ------------------------------------------------------------------------------------------------- CONNECT MAIN
// The owner's existing Farcaster account, connected by QR (lib/fc/connect.ts drives the flow; this file holds what it
// produces). D-FID-5-NO-CLIENT-FINGERPRINT: main and the personas must never be linked onchain, and must never
// interact — the record below is what the self-link guard (lib/fc/writes.ts) reads to tell main from everything else.

// NEVER HARDCODED: Totem's own account numbers. Every route's code also ships in the PUBLIC browser bundle
// (lib/device/routes.generated.ts), and a list of Totem's accounts there would publish the very linkage this guards. The
// lists below come from the owner service's environment, read at call time on the server; the device's environment
// never carries them.

function envFid(name: string): number | null {
  const raw = (process.env[name] ?? "").trim();
  if (!/^[1-9][0-9]{0,11}$/.test(raw)) return null;
  return Number(raw);
}

/** FC_RESERVED_FIDS: further fids that are Totem's own (comma-separated) — e.g. the unclaimed fids the developer's
 * Neynar App Wallet pre-registered beside the throwaway, from which the next persona acquisitions are drawn */
function envFidList(name: string): number[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[1-9][0-9]{0,11}$/.test(s))
    .map(Number);
}

/** Every account of this root that is NOT main: the shared test account (FC_TEST_FID), the anon account (FC_ANON_FID
 * when the app is told it, or `anonFid` — see anonAccountFid), FC_RESERVED_FIDS, and every persona fid this vault
 * holds. A "connected" record is main itself and is left out. */
export function ownAccountFids(records: PersonaFidRecord[], anonFid: number | null = null): Set<number> {
  const out = new Set<number>(envFidList("FC_RESERVED_FIDS"));
  const tw = envFid("FC_TEST_FID");
  if (tw) out.add(tw);
  const anon = envFid("FC_ANON_FID");
  if (anon) out.add(anon);
  if (anonFid) out.add(anonFid);
  for (const r of records) if (r.origin !== "connected") out.add(r.fid);
  return out;
}

/** the anonymous account is unknown to this app right now (THE refusal: never "no anon account") */
export class AnonAccountUnknownError extends Error {
  readonly code = "ANON_ACCOUNT_UNKNOWN";
}

/** what lib/zk/prefetch.ts keeps for the live universe — read here WITHOUT importing it (it pulls the whole ZK client
 *  in, and this file ships in every route bundle). prefetch.ts is the only writer of this global. */
type PrefetchGlobal = { __layersZkPrefetch?: { snapshots?: { live?: { anonConfig?: { fid?: unknown } | null } } } };

/**
 * CONNECT MAIN review (PUB-8, PL-2) — the anonymous account's fid, as far as THIS app can know it. arm-anon.ps1 sets
 * FC_ANON_FID on owner-validator (the relay's own setting); the app learns it from:
 *   1. FC_ANON_FID in the app's own environment, when it is set there too;
 *   2. otherwise, while the app runs the LIVE ZK universe (ZK_MODE=live — what arming anon sets on owner-app), the
 *      validator's anon relay config as the ZK prefetch last read it (the same signed read privacy condition 10 is
 *      judged from; never fetched here, so a write is never a beacon). The relay's fid stays named after a disarm.
 * No live ZK universe and no FC_ANON_FID: there is no anonymous account on this service (null). A live universe whose
 * relay config has not been read yet THROWS AnonAccountUnknownError — the callers refuse rather than guess (never fail
 * open): an unknown fid might be the anon account.
 */
export async function anonAccountFid(): Promise<number | null> {
  const env = envFid("FC_ANON_FID");
  if (env) return env;
  const { zkMode } = await import("@/lib/zk/config");
  if (zkMode() !== "live") return null;
  const cfg = (globalThis as unknown as PrefetchGlobal).__layersZkPrefetch?.snapshots?.live?.anonConfig;
  if (!cfg)
    throw new AnonAccountUnknownError(
      "Totem hasn't read your anonymous account's settings from the validator yet (the live ZK universe is on, and FC_ANON_FID is not set on this app) — try again in a few minutes, or set FC_ANON_FID on the owner app"
    );
  const fid = Number(cfg.fid);
  return Number.isInteger(fid) && fid > 0 ? fid : null;
}

/** ownAccountFids with the anon account as this app knows it — THROWS AnonAccountUnknownError (see anonAccountFid) */
export async function ownAccountFidsWithAnon(records: PersonaFidRecord[]): Promise<Set<number>> {
  return ownAccountFids(records, await anonAccountFid());
}

/** the fids that may never be main nor main's connector (today the same set as ownAccountFids) */
export function neverMainFids(records: PersonaFidRecord[], anonFid: number | null = null): Set<number> {
  return ownAccountFids(records, anonFid);
}

/**
 * CONNECT MAIN review (PL-4): the refusal for a persona handle (or the fname it would register) that derives from the
 * connected main account's name — matching names publicly link a persona to main, and no onchain care undoes that.
 * null = no connected main, or no derivation. Main stays main after a disconnect. THROWS on an unreadable vault (the
 * caller refuses).
 */
export async function mainNameDerivation(handle: string): Promise<string | null> {
  const mains = (await load()).items.filter((r) => r.origin === "connected" && r.fname);
  for (const m of mains) {
    if (derivedFromMain(handle, m.fname))
      return `@${handle} shares a name stem with your main account (@${m.fname}) — matching names publicly link a persona to your main account. Pick a handle that shares no stem with it.`;
  }
  return null;
}

/** the connected record(s) — at most one per root; more than one is a corrupted vault every caller refuses */
export async function connectedRecords(): Promise<PersonaFidRecord[]> {
  return (await load()).items.filter((r) => r.origin === "connected").map((r) => ({ ...r }));
}

/** the in-flight connection, or null */
export async function connectSession(): Promise<ConnectSession | null> {
  const s = (await load()).connect ?? null;
  return s ? { ...s } : null;
}

/** replace (or clear) the in-flight connection — sealed with the records, so a restart mid-approval loses nothing */
export async function putConnectSession(next: ConnectSession | null): Promise<void> {
  const doc = await load();
  doc.connect = next ? { ...next } : null;
  await save(doc);
}

export class ConnectRecordRefusal extends Error {
  readonly code = "CONNECT_REFUSED";
}

export interface ConnectedFidInput {
  personaId: string;
  fid: number;
  fname: string | null;
  /** main's custody address as the network reported it (the owner's Farcaster app holds the key) */
  custodyAddress: string;
  signerUuid: string;
  signerPublicKey: string;
  /** what GET /v2/farcaster/signer reported for signerUuid at finish: the approval is checked here, not trusted */
  approvedStatus: string;
  approvedFid: number | null;
  /** the onchain key add, read back from the chain (lib/fc/connect.ts verifyKeyAdd) */
  requestFid: number;
  requestSigner: string;
  keyAddTx: string | null;
  submittedBy: string | null;
  approvedAt: number;
  /** the connection's start: the persona must have been minted for THIS connection, not before it */
  sessionStartedAt: number;
  mode: "fixture" | "live";
}

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

/**
 * CONNECT MAIN — record the owner's main account against the keystore persona minted for it. Every check refuses
 * (throws ConnectRecordRefusal) rather than recording something half-true:
 *   - the persona is keystore-rooted (minted on this device, never a seeded fixture persona), public, not a fork (a
 *     fork carries a continuity proof to its source), and minted for this connection (created after it started);
 *   - at most ONE connected record per root (this vault is the root's): a second main is refused; reconnecting the
 *     SAME account after a disconnect re-arms the existing record in place;
 *   - the signer is approved for exactly this fid (the caller passes what the network answered at finish);
 *   - main is none of this root's other accounts, and its connector (the requestFid) is none of them either, nor main;
 *   - the record is flagged publicSelf — the fact the self-link guard and the identity branch key on.
 * The record does not count against the creation caps (it was never created) and its registrant/funder are "owner".
 */
export async function recordConnectedFid(input: ConnectedFidInput): Promise<PersonaFidRecord> {
  const refuse = (why: string): never => {
    throw new ConnectRecordRefusal(why);
  };
  if (input.mode !== "fixture" && input.mode !== "live") refuse("mode malformed");
  if (!Number.isInteger(input.fid) || input.fid <= 0) refuse("fid malformed");
  if (!Number.isInteger(input.requestFid) || input.requestFid <= 0) refuse("requestFid malformed");
  if (input.requestFid === input.fid) refuse("the connector (requestFid) is main itself — a connector is a separate account");
  if (typeof input.signerUuid !== "string" || !input.signerUuid.trim()) refuse("no signer");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.signerPublicKey)) refuse("signer public key malformed");
  if (!HEX40.test(input.custodyAddress)) refuse("custody address malformed");
  if (!HEX40.test(input.requestSigner)) refuse("requestSigner malformed");
  if (input.approvedStatus !== "approved" || input.approvedFid !== input.fid)
    refuse(`the signer is not approved for fid ${input.fid} (status ${input.approvedStatus}, fid ${input.approvedFid ?? "none"})`);

  const { isKeystoreRootedPersona, fcSignerPublicKeyFor } = await import("@/lib/identity/keys");
  const { kindOf } = await import("@/lib/identity/personaKind");
  const { getPersona } = await import("@/lib/identity/keystore");
  if (!isKeystoreRootedPersona(input.personaId)) refuse("main's persona must be minted on this device (keystore-rooted) — a seeded persona's keys are public by construction");
  if (kindOf(input.personaId) !== "public") refuse("main's persona must be public");
  const persona = getPersona(input.personaId);
  if (!persona) refuse("main's persona is not in this device's keystore");
  if (persona!.forkedFrom) refuse("main's persona must not be a fork — a fork carries a continuity proof to its source");
  const derivedPubHex = fcSignerPublicKeyFor(input.personaId);
  if (!derivedPubHex) refuse("main's persona has no derivable signer key");

  const doc = await load();
  const existing = doc.items.filter((r) => r.origin === "connected");
  if (existing.length > 1) refuse("this vault holds more than one connected account — refusing to add to a corrupted record set");
  const prior = existing[0] ?? null;
  // re-arming the same account after a disconnect keeps its persona (it was minted for main the first time)
  const rearm = !!prior && prior.personaId === input.personaId && prior.fid === input.fid && !!prior.connected?.disconnectedAt;
  if (prior && !rearm) refuse(prior.fid === input.fid ? "this account is already connected" : "one main account per root — another account is already connected (disconnect it first)");
  if (!rearm && persona!.createdAt < input.sessionStartedAt) refuse("main's persona must be minted for this connection — an existing persona is never re-purposed as main");
  // PERSONA LAUNCH P6 (fix LP-1): the checks see the LAUNCHED accounts too (merged view); only vault records are written
  const all = await mergedItems(doc);
  const others = all.filter((r) => r.origin !== "connected");
  if (others.some((r) => r.personaId === input.personaId)) refuse("this persona already owns a fid — one persona, one fid");
  if (all.some((r) => r.fid === input.fid && !(rearm && r === prior))) refuse("this fid is already mapped to a persona — one fid, one persona");
  let anonFid: number | null;
  try {
    anonFid = await anonAccountFid();
  } catch (e) {
    return refuse((e as Error).message + " — nothing was recorded");
  }
  const never = neverMainFids(all, anonFid);
  if (never.has(input.fid)) refuse(`fid ${input.fid} is one of this root's other accounts (or the shared test account) — it can never be main`);
  if (never.has(input.requestFid)) refuse(`the connector fid ${input.requestFid} is one of this root's other accounts — main's key request would link them onchain`);
  const lower = (s: string) => s.toLowerCase();
  if (others.some((r) => lower(r.custodyAddress) === lower(input.custodyAddress) || lower(r.custodyAddress) === lower(input.requestSigner)))
    refuse("main's custody (or the connector's) is a persona's custody address — refused");

  const now = Date.now();
  const rec: PersonaFidRecord = {
    personaId: input.personaId,
    fid: input.fid,
    fname: input.fname,
    origin: "connected",
    custodyAddress: input.custodyAddress,
    // derivedPubHex binds the record to THIS persona by derivation (the identity branch re-derives it at write time);
    // it is not registered on main — the Neynar-generated key is the one main approved
    signer: { kind: "neynar-managed", uuid: input.signerUuid, derivedPubHex: derivedPubHex!, derivedRegistered: false },
    registrant: "owner",
    funder: "owner",
    createdAt: rearm && prior ? prior.createdAt : now,
    mode: input.mode,
    connected: {
      publicSelf: true,
      requestFid: input.requestFid,
      requestSigner: input.requestSigner,
      signerPublicKey: input.signerPublicKey.toLowerCase(),
      keyAddTx: input.keyAddTx,
      submittedBy: input.submittedBy,
      approvedAt: input.approvedAt,
      verifiedAt: now,
      disconnectedAt: null,
      disconnectReason: null,
    },
  };
  doc.items = rearm && prior ? doc.items.map((r) => (r === prior ? rec : r)) : [...doc.items, rec];
  // the connection is done: ITS session (and its signer uuid copy) goes in the same seal — never another one's
  if (doc.connect && doc.connect.signerUuid === input.signerUuid) doc.connect = null;
  await save(doc);
  return { ...rec };
}

/** CONNECT MAIN — disconnect: wipe main's signer uuid and stop every write as main. The record stays (as a tombstone)
 * so the self-link guard keeps main apart from the personas; only the Farcaster app can remove the key itself.
 * CONNECT MAIN review (UXC-02): `reason` "revoked_in_app" when Farcaster reported the key revoked (the owner removed
 * Totem in the Farcaster app), so the page and the composer can say that instead of "Totem can post as you". */
export async function disconnectConnectedFid(personaId: string, reason: "owner" | "revoked_in_app" = "owner"): Promise<PersonaFidRecord | null> {
  const doc = await load();
  const rec = doc.items.find((r) => r.origin === "connected" && r.personaId === personaId);
  if (!rec || !rec.connected) return null;
  if (rec.connected.disconnectedAt && reason === "revoked_in_app") return { ...rec }; // already off: keep its first reason
  const next: PersonaFidRecord = {
    ...rec,
    signer: rec.signer.kind === "neynar-managed" ? { ...rec.signer, uuid: "" } : rec.signer,
    connected: { ...rec.connected, disconnectedAt: Date.now(), disconnectReason: reason },
  };
  doc.items = doc.items.map((r) => (r === rec ? next : r));
  await save(doc);
  return { ...next };
}
