import "server-only";
// ZK PASS 1 — the client's view of the validator's PUBLIC zk surface:
// epoch, trees, members, signed placements, signed root history, and
// registration. Everything here is public material (commitments, roots,
// signatures, epochs). Nothing here trusts a "valid" bit: signatures are
// verified by lib/zk/rootHistory.ts, proofs by the transport — this module
// only moves bytes.
//
// NEVER FAIL OPEN: every helper throws on transport/HTTP failure. A caller
// that wanted "absent" gets to say so itself, per call site.
import { VALIDATOR_URL, type ZkMode } from "./config";

/** PERSONA LAUNCH wave 2 (verify): an unreachable validator names its CAUSE (ECONNREFUSED, ECONNRESET, UND_ERR_SOCKET, …).
 *  undici's own message is only "fetch failed", which hid whether a tick met a dead validator, a reset socket or a
 *  timeout (accept-z8 check 4 after accept-z7's validator restart). No request data: the code and the cause's message. */
export function unreachableCause(e: unknown): string {
  const c = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  const why = c ? c.code ?? c.message : null;
  return (e as Error)?.message + (why ? " [" + String(why).slice(0, 80) + "]" : "");
}

export interface ZkEpochInfo {
  mode: ZkMode;
  epoch: number;
  epochMs: number;
  msRemaining: number;
}
export interface ZkTreeStatus {
  tree: string;
  epoch: number;
  root: string;
  size: number;
  floor: number;
  clearsFloor: boolean;
}
export interface ZkHistoryEntry {
  mode: ZkMode;
  tree: string;
  epoch: number;
  root: string;
  prevHash: string;
  hash: string;
  sig: string;
}
export interface ZkPlacement {
  mode: ZkMode;
  tree: string;
  epoch: number;
  commitment: string;
  leafIndex: number;
  root: string;
  sig: string;
}
export interface ZkMembers {
  mode: ZkMode;
  tree: string;
  epoch: number;
  root: string;
  members: string[];
}

async function vget<T>(pathAndQuery: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + pathAndQuery, { cache: "no-store" });
  } catch (e) {
    throw new Error(`zk validator unreachable (${pathAndQuery}): ${unreachableCause(e)}`);
  }
  if (!res.ok) throw new Error(`zk validator refused ${pathAndQuery}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchValidatorKey(): Promise<string> {
  const r = await vget<{ pubkey: string }>("/zk/validator-key");
  if (!/^[0-9a-f]{64}$/.test(r.pubkey ?? "")) throw new Error("zk validator key malformed");
  return r.pubkey;
}

export async function fetchEpoch(mode: ZkMode): Promise<ZkEpochInfo> {
  return vget<ZkEpochInfo>(`/zk/epoch?mode=${mode}`);
}

/** MULTI-FID Gate 4: the relayed anon casts — a PUBLIC read (no viewer, no persona), like any feed */
export interface AnonCast {
  hash: string;
  castHash: string;
  text: string;
  at: number;
  fid: number;
  epoch: number;
  /** MULTI-FID PASS — the anoncast reveal pattern: null until the poster chooses to attribute it */
  attributedFid: number | null;
  attributedAt: number | null;
  /** §14.2 — the signer key the reveal verified under; the READER ties it to the fid (key registry) */
  attributedSigner?: string | null;
  /** PERSONA LAUNCH P5: the tree the post proved (the plain anon tree, or a reach tree attest:<issuer>/<bucket>) and that
   * tree's frozen size at the post's epoch — what the For You label is judged from (lib/reach/boost.ts); null on rows
   * from before P5 */
  tree?: string | null;
  treeSize?: number | null;
  /** PERSONA LAUNCH P4: the 256-byte ring note as 512 hex — ring members trial-decrypt it on their device; null on rows
   * from before P4. Never copied onto a card. */
  note?: string | null;
  /** PERSONA LAUNCH P6: the batch reveal that attributed this post at launch (the registrar's batch hash), else null */
  attributedBatch?: string | null;
}
export async function fetchAnonCasts(mode: ZkMode): Promise<AnonCast[]> {
  const r = await vget<{ casts: AnonCast[] }>(`/zk/anon-casts?mode=${mode}`);
  const casts = Array.isArray(r.casts) ? r.casts : [];
  // PUBLIC GO-LIVE: the last list this device read (the uniform reads every tick and every feed build make), kept in memory
  // so a post's Farcaster link is found without a read of its own (app/api/anon/route.ts castUrl) — never a per-post fetch
  (globalThis as unknown as { __layersLastAnonCasts?: Partial<Record<ZkMode, { at: number; casts: AnonCast[] }>> }).__layersLastAnonCasts ??= {};
  (globalThis as unknown as { __layersLastAnonCasts: Partial<Record<ZkMode, { at: number; casts: AnonCast[] }>> }).__layersLastAnonCasts[mode] = { at: Date.now(), casts };
  return casts;
}
/** PUBLIC GO-LIVE: the anon list this device last read for `mode` (memory only; null when none was read yet) */
export function lastAnonCasts(mode: ZkMode): { at: number; casts: AnonCast[] } | null {
  return (globalThis as unknown as { __layersLastAnonCasts?: Partial<Record<ZkMode, { at: number; casts: AnonCast[] }>> }).__layersLastAnonCasts?.[mode] ?? null;
}
export interface AnonPostConfig {
  tree: string;
  windowEpochs: number;
  maxChars: number;
  liveRelay: boolean;
  armed?: boolean;
  fid: number;
  relayKeyFingerprint?: string | null;
  relayIntervalMs?: number;
  /** ANON REVIEW (R1-03): each pending row's relay moment is drawn over [slot, slot + spread]. PERSONA LAUNCH P3 (D4):
   * 30 minutes on the public shape, 0 on the rig and the owner service (validator/zk.js anonRelaySpreadMs) */
  relaySpreadMs?: number;
  /** PERSONA LAUNCH P3: the validator's K (anon posts per person per window). Public. The client COMPARES it with its
   * own K (lib/zk/config.ts ZK_ANON_POST_SLOTS) and refuses on a mismatch — it never chooses slots with it. */
  slotsPerWindow?: number;
  /** PERSONA LAUNCH P3 (D4): the global daily cap and today's count — signed readers only (an unsigned count is a
   * submission-time oracle, R1-05) */
  dailyCap?: number;
  dailyUsed?: number;
  pending?: number;
  /** ANON REVIEW (A2-3, R3-19) — served by the reviewed validator to a signed reader: the cap and the row counts, and
   * whether the relay signer is approved for the anon fid right now */
  /** the LIFETIME live cap; null on the public shape when not set explicitly (PERSONA LAUNCH P3: the daily cap rules there) */
  cap?: number | null;
  relayed?: number;
  failed?: number;
  signerApproved?: boolean | null;
  /** the validator's last refusal of a given cast hash (asked with ?castHash=; signed readers only) */
  lastRefusal?: { reason: string; at: number } | null;
  /** PERSONA LAUNCH P5: the reach issuers whose bucket trees this validator accepts anon posts into (ZK_ANON_REACH_ISSUERS).
   * Public. The client offers a reach tier only for an issuer in this list AND honoured by key on the client (absent =
   * a validator from before P5: no reach tier is offered). */
  reachIssuers?: string[];
  /** PUBLIC GO-LIVE (ASM-1): true when the validator refuses every live anon post that is not into the gated plain tree
   *  (the fid gate is on); arm-public-anon.ps1 refuses to arm without it */
  liveTreeOnly?: boolean;
  /** PUBLIC GO-LIVE: public configuration of the public relay — the fid gate on the live tree, a moderator set up, the
   *  text filter running, the relay path ("agent": the public @anon; "owner": the owner service) */
  fidGate?: boolean;
  moderated?: boolean;
  filter?: string;
  relayKind?: "agent" | "owner";
  /** PUBLIC GO-LIVE (signed readers only): why the agent path is not armed — names and plain reasons, never a value */
  relayProblems?: string[];
}
/** ANON REVIEW (R1-05): the sensitive half of this answer (fid, armed, fingerprint, pending count) is an oracle on a
 * public validator, so the reviewed validator serves it only to the device envelope; this read signs when the
 * deployment is armed (the same label as the other gated zk reads) and gets the full shape, and the unsigned shape
 * (tree, window, max chars, liveRelay) otherwise. A validator that predates the change ignores the headers. */
export async function fetchAnonPostConfig(mode: ZkMode, castHash?: string): Promise<AnonPostConfig> {
  const { signedReadHeaders } = await import("@/lib/adapters/mock/persist");
  const headers = await signedReadHeaders("zk:eligibility");
  const q = `/zk/anon-post/config?mode=${mode}` + (castHash && /^[0-9a-f]{64}$/.test(castHash) ? `&castHash=${castHash}` : "");
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + q, { cache: "no-store", headers });
  } catch (e) {
    throw new Error(`zk validator unreachable (${q}): ${unreachableCause(e)}`);
  }
  if (!res.ok) throw new Error(`zk validator refused ${q}: HTTP ${res.status}`);
  return (await res.json()) as AnonPostConfig;
}

export async function fetchTrees(mode: ZkMode): Promise<ZkTreeStatus[]> {
  const r = await vget<{ trees: ZkTreeStatus[] }>(`/zk/trees?mode=${mode}`);
  return r.trees;
}

export async function fetchHistory(mode: ZkMode, tree: string): Promise<{ pubkey: string; entries: ZkHistoryEntry[] }> {
  return vget<{ pubkey: string; entries: ZkHistoryEntry[] }>(`/zk/history?mode=${mode}&tree=${encodeURIComponent(tree)}`);
}

export async function fetchMembers(mode: ZkMode, tree: string): Promise<ZkMembers> {
  return vget<ZkMembers>(`/zk/members?mode=${mode}&tree=${encodeURIComponent(tree)}`);
}

export async function fetchPlacement(mode: ZkMode, tree: string, commitment: string): Promise<ZkPlacement | null> {
  let res: Response;
  const q = `/zk/placement?mode=${mode}&tree=${encodeURIComponent(tree)}&commitment=${encodeURIComponent(commitment)}`;
  try {
    res = await fetch(VALIDATOR_URL + q, { cache: "no-store" });
  } catch (e) {
    throw new Error(`zk validator unreachable (placement): ${unreachableCause(e)}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`zk validator refused placement: HTTP ${res.status}`);
  return ((await res.json()) as { placement: ZkPlacement }).placement;
}

/** Gate 2: what a persona has PROVEN for a gate this epoch (or the grace). */
export interface ZkEligibility {
  personaId: string;
  gateId: string;
  tier: number;
  epoch: number;
}

/** The eligibility store is NOT a public feed (attack-1 finding 5 /
 * attack-3 F-9): when the deployment is armed the validator requires the
 * device-signed envelope on these reads. This is the app's IDENTIFIED
 * channel — the feed build asking for the gate's map is identified anyway. */
async function vgetSigned<T>(pathAndQuery: string): Promise<T> {
  const { signedReadHeaders } = await import("@/lib/adapters/mock/persist");
  const headers = await signedReadHeaders("zk:eligibility");
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + pathAndQuery, { cache: "no-store", headers });
  } catch (e) {
    throw new Error(`zk validator unreachable (${pathAndQuery}): ${unreachableCause(e)}`);
  }
  if (!res.ok) throw new Error(`zk validator refused ${pathAndQuery}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchEligibility(mode: ZkMode, personaId: string, gateId: string): Promise<ZkEligibility | null> {
  const q = `/zk/eligibility?mode=${mode}&gateId=${encodeURIComponent(gateId)}&personaId=${encodeURIComponent(personaId)}`;
  const r = await vgetSigned<{ eligibility: ZkEligibility | null }>(q);
  return r.eligibility ?? null;
}

/** Every persona's proven tier for a gate at the current epoch / grace —
 * one call per feed build, so the discovery pass never does N lookups. */
export async function fetchEligibilityMap(mode: ZkMode, gateId: string): Promise<Record<string, number>> {
  const r = await vgetSigned<{ epoch: number; tiers: Record<string, number> }>(`/zk/eligibility?mode=${mode}&gateId=${encodeURIComponent(gateId)}`);
  return r.tiers ?? {};
}

export interface RegistrationBody {
  mode: ZkMode;
  commitment: string;
  rootId: string;
  issuedAt: number;
  signature: string;
  /** BROWSER KEYSTORE PASS: which root's device-auth key signed (multi-anchor validator) */
  anchorPubKey?: string;
}

export async function postRegistration(body: RegistrationBody): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + "/zk/register", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`zk validator unreachable (register): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// ---------- ZK PASS 2 Gate 3 ----------
export interface RevocationBody {
  mode: ZkMode;
  commitment: string;
  rootId: string;
  issuedAt: number;
  signature: string;
  anchorPubKey?: string;
}

/** revocation via epoch re-issuance: signed like a registration, append-only on the validator */
export async function postRevocation(body: RevocationBody): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + "/zk/revoke", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`zk validator unreachable (revoke): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** has this persona PROVEN continuity under this fork commitment? (public read) */
export async function fetchForkClaim(mode: ZkMode, personaId: string, forkCommit: string): Promise<{ verified: boolean; tree?: string; tier?: number; epoch?: number }> {
  return vget(`/zk/fork-claim?mode=${mode}&personaId=${encodeURIComponent(personaId)}&forkCommit=${encodeURIComponent(forkCommit)}`);
}

export interface ZkAttestation {
  issuer: string;
  bucket: string;
  claimHash: string;
  issuedEpoch: number;
  activeFromEpoch: number;
  expiresEpoch: number;
  revokedFromEpoch: number | null;
  activeNow: boolean;
}
/** the attestations on a commitment — a GATED read (Gate 4): the subject reads its own through its device */
export async function fetchAttestations(mode: ZkMode, commitment: string): Promise<{ epoch: number; attestations: ZkAttestation[] }> {
  return vgetSigned(`/zk/attestations?mode=${mode}&commitment=${encodeURIComponent(commitment)}`);
}

/** what a persona has PROVEN for an issuer (optionally one bucket) this epoch (gated like eligibility) */
export async function fetchAttested(mode: ZkMode, personaId: string, issuer: string, bucket?: string): Promise<{ attested: boolean; epoch: number | null; buckets: string[] }> {
  const b = bucket === undefined ? "" : `&bucket=${encodeURIComponent(bucket)}`;
  return vgetSigned(`/zk/attested?mode=${mode}&personaId=${encodeURIComponent(personaId)}&issuer=${encodeURIComponent(issuer)}${b}`);
}

// ---------- ATTESTATION PASS Gate 1: the open issuer interface ----------
async function vpost(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`zk validator unreachable (${path}): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export interface ZkIssuer {
  id: string;
  displayName: string;
  claimSchema: Record<string, unknown>;
  buckets: string[];
  validityEpochs: number;
  trustTier: "attested";
  pubkey: string;
  registeredAt: number;
}
/** the validator's open issuer registry (public) */
export async function fetchIssuers(mode: ZkMode): Promise<{ mode: ZkMode; epoch: number; issuers: ZkIssuer[] }> {
  return vget(`/zk/issuers?mode=${mode}`);
}
/** open, self-signed registration (lib/attest/registry.ts signs) */
export async function registerIssuerOnValidator(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/issuers", body);
}
export interface ZkAttestationPublicPart {
  issuer: string;
  bucket: string;
  commitment: string;
  claimHash: string;
  issuedEpoch: number;
  expiresEpoch: number;
  sig: string;
}
/** the PUBLIC parts of one or more issuer-signed issuances — never a value. Gate 4: the batch
 * is signed by this root's device-auth key (attack-att-3 #2 — a stranger cannot enter an
 * issuance for a commitment it does not hold). */
export async function submitAttestations(mode: ZkMode, attestations: ZkAttestationPublicPart[]): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const { signAsDeviceAuth, deviceAuthPublicKey } = await import("@/lib/identity/keystore");
  const { attestSubmitCanonical } = await import("@/lib/attest/canonical");
  const issuedAt = Date.now();
  const partsJson = JSON.stringify(attestations);
  const signature = signAsDeviceAuth(attestSubmitCanonical(mode, partsJson, issuedAt));
  return vpost("/zk/attest", { mode, attestations, issuedAt, signature, anchorPubKey: deviceAuthPublicKey() });
}
export async function revokeAttestationOnValidator(body: { mode: ZkMode; issuer: string; bucket: string; commitment: string; issuedAt: number; sig: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/attest/revoke", body);
}
export interface ZkBucketCensus {
  issuer: string;
  bucket: string;
  tree: string;
  size: number;
  floor: number;
  clearsFloor: boolean;
}
/** the per-bucket census for the epoch (public; the validator's floor opinion, never the label's) */
export async function fetchAttestBuckets(mode: ZkMode): Promise<{ mode: ZkMode; epoch: number; floor: number; buckets: ZkBucketCensus[] }> {
  return vget(`/zk/attest/buckets?mode=${mode}`);
}
/** every persona's proven (issuer/bucket) set this epoch — one gated read for a feed build */
export async function fetchAttestedMap(mode: ZkMode): Promise<{ epoch: number; claims: Record<string, string[]> }> {
  return vgetSigned(`/zk/attested-map?mode=${mode}`);
}

// ---------- PERSONA LAUNCH P8: the @totem X outbox (validator/xoutbox.js), FIXTURE ONLY ----------
/** the outbox's public configuration: K_X (the client COMPARES it with its own, never adopts it), the daily cap and
 *  today's count (public anyway: the list shows every row's hour), whether any moderator is set up, their PUBLIC keys */
export interface XOutboxConfig {
  mode: ZkMode;
  testData: true;
  transport: "fixture";
  live: false;
  xSlotsPerWindow: number;
  dailyCap: number;
  dailyUsed: number;
  postedToday: number;
  relayIntervalMs: number;
  relaySpreadMs: number;
  moderated: boolean;
  moderators: string[];
}
/** one row of the PUBLIC list: never the text before it is posted, never anything that names a poster */
export interface XOutboxRow {
  id: string;
  status: "review" | "approved" | "rejected" | "posted" | "failed";
  hour: number;
  postedId: string | null;
  text: string | null;
}
export async function fetchXOutboxConfig(mode: ZkMode): Promise<XOutboxConfig> {
  return vget<XOutboxConfig>(`/x/outbox/config?mode=${mode}`);
}
/** the WHOLE public list (the latest 200) — every offering device reads it on the fixed schedule, never one id */
export async function fetchXOutboxList(mode: ZkMode): Promise<XOutboxRow[]> {
  const r = await vget<{ items: XOutboxRow[] }>(`/x/outbox?mode=${mode}`);
  if (!Array.isArray(r.items)) throw new Error("the X outbox list is malformed");
  return r.items;
}
/** the moderator's signed decision (an identified act by design: the owner's device decides) */
/** PERSONA LAUNCH wave 3 (W3-X-MOD-SAME-HOUR): the signed decision carries its fresh nonce (moderate/2) */
export async function postXModeration(body: { mode: ZkMode; id: string; decision: "approve" | "reject"; issuedHour: number; nonce: string; pubkey: string; sig: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/x/outbox/moderate", body);
}
/** the moderator's signed read of the texts waiting for a decision */
export async function fetchXReview(q: { mode: ZkMode; issuedHour: number; pubkey: string; sig: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  const path = `/x/outbox/review?mode=${q.mode}&issuedHour=${q.issuedHour}&pubkey=${q.pubkey}&sig=${q.sig}`;
  try {
    res = await fetch(VALIDATOR_URL + path, { cache: "no-store" });
  } catch (e) {
    throw new Error(`zk validator unreachable (/x/outbox/review): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
/** RIG ONLY (the validator refuses without ZK_DEV_HOOKS): register a moderator key, relay now, read the fixture transport */
export async function xOutboxDev(action: "moderator" | "relay-now" | "reset", body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost(`/x/outbox/dev/${action}`, body);
}
export async function fetchXTransportLog(mode: ZkMode): Promise<{ entries: Array<{ destination: string; postedId: string; text: string; hour: number }> }> {
  return vget(`/x/outbox/dev/transport-log?mode=${mode}`);
}

// ------------------------------------------------------------------------------------------------ PUBLIC GO-LIVE: the public @anon
// validator/anonpublic.js. Reports and the fid join are plain public writes (no device envelope: a report names no reporter,
// a join is authenticated by the Farcaster signature it carries); the moderator's read and decision are signed by the
// moderator key in the body / query, exactly like the X outbox's.

/** a Report: the cast and a reason from the fixed list — nothing that names who reported it */
/** THE HUB ROUTE: @anon's casts as the Farcaster protocol has them (the validator's keyless castsByFid read of its
 *  FC_HUB_URL, hidden rows left out) — the raw answer: 200 {source, fid, casts}, 501 not set up, 503 the hub unread */
export interface AnonNetworkCast {
  hash: string;
  castHash: string | null;
  text: string;
  at: number | null;
  castUrl: string | null;
}
export async function fetchAnonNetworkCasts(limit = 50): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(VALIDATOR_URL + "/zk/anon/network-casts?limit=" + Math.max(1, Math.min(100, Math.floor(limit))), { cache: "no-store" });
  } catch (e) {
    throw new Error(`zk validator unreachable (/zk/anon/network-casts): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
export async function postAnonReport(body: { mode: ZkMode; castHash: string; reason: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/anon/report", body);
}
/** the public relay's public status (names and booleans only) */
export interface AnonPublicStatus {
  mode: ZkMode;
  /** PUBLIC GO-LIVE (ASM-4): deletesReady — a moderator's removal can reach Farcaster now (the credential alone; true while
   *  the relay's switch is off, false once the key is revoked). Absent on a validator from before the fix. */
  relay: { kind: "agent" | "owner"; ready: boolean; transport: string | null; problems: string[]; deletesReady?: boolean };
  fidGate: { on: boolean; domain: string | null; chain: string };
  moderated: boolean;
  moderators: string[];
  filter: string;
  reportReasons: string[];
}
export async function fetchAnonPublicStatus(mode: ZkMode): Promise<AnonPublicStatus> {
  return vget<AnonPublicStatus>(`/zk/anon/public-status?mode=${mode}`);
}
/** the moderator's signed read of the reported casts */
export async function fetchAnonModeration(q: { mode: ZkMode; issuedHour: number; pubkey: string; sig: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  const path = `/zk/anon/moderation?mode=${q.mode}&issuedHour=${q.issuedHour}&pubkey=${q.pubkey}&sig=${q.sig}`;
  try {
    res = await fetch(VALIDATOR_URL + path, { cache: "no-store" });
  } catch (e) {
    throw new Error(`zk validator unreachable (/zk/anon/moderation): ${unreachableCause(e)}`);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
/** the moderator's signed decision (an identified act by design: the moderator's own device decides) */
export async function postAnonModeration(body: { mode: ZkMode; castHash: string; decision: "remove" | "keep"; issuedHour: number; nonce: string; pubkey: string; sig: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/anon/moderation", body);
}
/** the fid gate's join: the signed Sign in with Farcaster message, this device's CROWD commitment (lib/zk/anon/fcJoin.ts,
 *  never the root's registered one: PRIV-LIVE-1) and the salt the nonce binds */
export async function postFidJoin(body: { mode: "live"; fid: number; message: string; signature: string; authMethod: string; commitment: string; salt: string }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/anon/fid-join", body);
}
/** PUBLIC GO-LIVE (ASM-5): leave the live crowd — the crowd identity's public key and its EdDSA-Poseidon signature over the
 *  leave (lib/zk/anon/fcJoin.ts signFidLeave); a plain public write (the signature is the authentication) */
export async function postFidLeave(body: { mode: "live"; commitment: string; publicKey: [string, string]; signature: { R8: [string, string]; S: string }; issuedHour: number }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/anon/fid-leave", body);
}
/** RIG ONLY (the validator refuses without ZK_DEV_HOOKS): make a key a test moderator */
export async function anonDevModerator(pubkey: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return vpost("/zk/anon/dev/moderator", { pubkey });
}
