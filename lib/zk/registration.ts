import "server-only";
// ZK PASS 1 — registration of C_root, authenticated by the DEVICE-AUTH key.
//
// One commitment per root, first-write-wins (409 discipline). Signed by the
// root's device-auth key — the anchor the validator already trusts — and
// deliberately NOT by any persona key: a persona-signed registration would
// bind that persona to the commitment in the validator's own records.
// Registration must never run from a persona context either (the route
// refuses a view-as cookie or a personaId in the body); it is an
// account-level action.
//
// THE RESIDUAL LEAK, STATED: the validator learns commitment ↔ account
// (rootId) and the join-epoch. That is Semaphore's trust shape and it is
// the honest claim: persona→root unlinkability, NOT account-existence
// privacy (F9/C10). Insertion into the trees is BATCHED to the next epoch
// so "first proof right after a tree insert" cannot single out the new
// member.
import { deviceAuthPublicKey, signAsDeviceAuth } from "@/lib/identity/keystore";
import { getSelf } from "@/lib/data";
import { VALIDATOR_URL, ZK_MODE, type ZkMode } from "./config";
import { zkCommitment } from "./identity";
import { postRegistration, postRevocation } from "./validatorClient";

/** DELIBERATE DUPLICATE of validator/zk.js registerCanonical. */
export function registerCanonical(mode: ZkMode, commitment: string, rootId: string, issuedAt: number): string {
  return ["layers-zk-register/1", mode, commitment, rootId, String(issuedAt)].join("|");
}

/** DELIBERATE DUPLICATE of validator/zk.js revokeCanonical (Gate 3). */
export function revokeCanonical(mode: ZkMode, commitment: string, rootId: string, issuedAt: number): string {
  return ["layers-zk-revoke/1", mode, commitment, rootId, String(issuedAt)].join("|");
}

/** DELIBERATE DUPLICATE of lib/device/boot.ts pseudoFid and validator/server.js (POST /roots): the NEGATIVE fid a
 * root with no network identity is registered under, derived from its device-auth anchor — a value no network ever
 * issues, bound to the signing anchor by the validator. */
export function pseudoFidOfAnchor(anchorPubHex: string): number {
  return -((parseInt(anchorPubHex.slice(0, 8), 16) % 2147483646) + 1);
}

/**
 * D-ANON-OWNER-ROOT (ANON REVIEW A2-1 / R3-01 — the functional hard stop; scripts/owner/arm-anon.ps1 greps this
 * marker in the commit the owner app reports before it arms anything): which root a registration is addressed to,
 * in this order.
 *   1. this device's OWN root — the one it registered under its device-derived pseudo-fid (the browser device does
 *      this at boot; a server device does it here, below), looked up in the device's vault roster;
 *   2. the account's legacy handle (rootForFid(getSelf().fid)): the rig's seeded self root from the fixture export,
 *      kept so the rig's existing registrations (keyed by that root) stay valid;
 *   3. neither — the owner service under LAYERS_WORLD=empty, whose self fid is the seed's (9152) and whose roster
 *      drops every fixture root: REGISTER THIS DEVICE'S OWN ROOT NOW, exactly as lib/device/boot.ts does — a root row
 *      with the anchor-derived negative fid over the signed envelope (the validator binds roots.anchor to the signing
 *      anchor and checks the fid against it), recorded in the vault roster so the next call resolves it at step 1.
 * Nothing here ever uses a root whose anchor cannot sign (the seeded self root carries the sentinel anchor "seed" on a
 * freshly seeded validator — registerCommitment falls through to step 3 when the validator answers that it has no
 * device-auth anchor for the root it was handed).
 */
export function chooseRegistrationRoot(opts: { ownRoot: string | null; legacyRoot: string | null; skipLegacy?: boolean }): "own" | "legacy" | "register-own" {
  if (opts.ownRoot) return "own";
  if (opts.legacyRoot && !opts.skipLegacy) return "legacy";
  return "register-own";
}

async function ensureOwnRoot(): Promise<string> {
  const anchor = deviceAuthPublicKey();
  const fid = pseudoFidOfAnchor(anchor);
  const { recordRoot, rootForFid } = await import("@/lib/identity/rootRoster");
  const existing = await rootForFid(fid);
  if (existing) return existing;
  const { registerRoot } = await import("@/lib/validator");
  const rootId = await registerRoot(fid, "device:" + anchor);
  if (!rootId) throw new Error("zk registration: the validator refused to register this device's own root (a device root needs the signed envelope — LAYERS_REQUIRE_SIG=true on both sides — and a reachable validator)");
  await recordRoot(rootId, fid);
  return rootId;
}

/** SERVER-INTERNAL: the validator's own id for this account's root. It is
 * used to address the registration and is never returned to a client
 * (the root-leak grep enforces that, as it does for session.rootId). */
async function ownValidatorRootId(opts: { skipLegacy?: boolean } = {}): Promise<string> {
  // ZK PASS 2 Gate 2: the DEVICE holds its own root handle (the vault
  // roster for signer-registered roots; the pre-006 fixture export for the
  // fixture self). The validator no longer answers "which root is fid X's"
  // through personas (migration 006).
  const { rootForFid } = await import("@/lib/identity/rootRoster");
  const ownRoot = await rootForFid(pseudoFidOfAnchor(deviceAuthPublicKey()));
  const legacyRoot = await rootForFid(getSelf().fid);
  const choice = chooseRegistrationRoot({ ownRoot, legacyRoot, skipLegacy: opts.skipLegacy });
  if (choice === "own") return ownRoot as string;
  if (choice === "legacy") return legacyRoot as string;
  return ensureOwnRoot();
}

/** the validator's answer when the root it was handed has an anchor that cannot sign (a seeded root) */
const NO_ANCHOR_RE = /no device-auth anchor registered for this root/i;

export interface RegistrationResult {
  status: number;
  ok: boolean;
  existing?: boolean;
  epochRegistered?: number;
  activeFromEpoch?: number;
  error?: string;
}

export async function registerCommitment(mode: ZkMode = ZK_MODE, commitment: string = zkCommitment()): Promise<RegistrationResult> {
  const attempt = async (rootId: string) => {
    const issuedAt = Date.now();
    const signature = signAsDeviceAuth(registerCanonical(mode, commitment, rootId, issuedAt));
    const { status, json } = await postRegistration({ mode, commitment, rootId, issuedAt, signature, anchorPubKey: deviceAuthPublicKey() });
    const r: RegistrationResult = {
      status,
      ok: status === 200 || status === 201,
      existing: json?.existing === true,
      epochRegistered: typeof json?.epochRegistered === "number" ? (json.epochRegistered as number) : undefined,
      activeFromEpoch: typeof json?.activeFromEpoch === "number" ? (json.activeFromEpoch as number) : undefined,
      error: typeof json?.error === "string" ? (json.error as string) : undefined,
    };
    return r;
  };
  const first = await attempt(await ownValidatorRootId());
  // ANON REVIEW (A2-1 (b)): the legacy root exists but its anchor is the seed sentinel — nothing can ever sign for it.
  // Register this device's own root instead and address the registration there (once; a second 409 is final).
  if (first.status === 409 && NO_ANCHOR_RE.test(first.error ?? "")) {
    return attempt(await ownValidatorRootId({ skipLegacy: true }));
  }
  return first;
}

// ---------- ZK PASS 2 Gate 3: REVOCATION VIA EPOCH RE-ISSUANCE ----------
export interface RevocationResult {
  status: number;
  ok: boolean;
  existing?: boolean;
  revokedFromEpoch?: number;
  error?: string;
  /** PUBLIC GO-LIVE (ASM-5): the live crowd's leave sent first (live mode only; null otherwise) */
  crowdLeave?: { ok: boolean; status: number; leftFromEpoch: number | null; error: string | null } | null;
}

/** Revoke THIS device's current commitment: signed by the device-auth key
 * like a registration; append-only on the validator; effective from the
 * NEXT epoch (this epoch's trees are frozen — the invariant). */
export async function revokeCommitment(mode: ZkMode = ZK_MODE): Promise<RevocationResult> {
  // PUBLIC GO-LIVE (ASM-5): a root revocation cannot reach the live crowd's commitment (it is never registered, and no
  // table ties it to this root — PRIV-LIVE-1), and re-issuance changes the zk master the crowd identity is derived from,
  // so the old crowd leaf leaves first, signed by the crowd identity itself. Never throws (fcLeaveCrowd answers in words).
  let crowdLeave: RevocationResult["crowdLeave"] = null;
  if (mode === "live") crowdLeave = await (await import("./anon/fcJoin")).fcLeaveCrowd();
  const commitment = zkCommitment();
  const rootId = await ownValidatorRootId();
  const issuedAt = Date.now();
  const signature = signAsDeviceAuth(revokeCanonical(mode, commitment, rootId, issuedAt));
  const { status, json } = await postRevocation({ mode, commitment, rootId, issuedAt, signature, anchorPubKey: deviceAuthPublicKey() });
  return {
    status,
    ok: status === 200,
    existing: json?.existing === true,
    revokedFromEpoch: typeof json?.revokedFromEpoch === "number" ? (json.revokedFromEpoch as number) : undefined,
    error: typeof json?.error === "string" ? (json.error as string) : undefined,
    crowdLeave,
  };
}

/** The ritual, in order: revoke the current commitment → register the NEXT
 * branch's commitment (a leaf from the next epoch) → mark it PENDING. The
 * device keeps proving with the old branch until the tick that sees the
 * activation epoch promotes the new one (attack-z2-2 #4: switching
 * mid-epoch left the root's unproved personas dark until the boundary).
 * Nothing is un-revoked, ever. */
export async function reissueIdentity(mode: ZkMode = ZK_MODE): Promise<{ revoked: RevocationResult; index: number; commitment: string; registration: RegistrationResult; pending: boolean }> {
  const revoked = await revokeCommitment(mode);
  if (!revoked.ok) throw new Error("re-issuance refused: " + (revoked.error ?? "revocation failed (is the current commitment registered?)"));
  const { zkCommitmentAt, zkIdentityIndexNow, setZkPendingIdentity } = await import("./identity");
  const index = zkIdentityIndexNow() + 1;
  const commitment = zkCommitmentAt(index);
  const registration = await registerCommitment(mode, commitment);
  if (registration.ok && typeof registration.activeFromEpoch === "number") setZkPendingIdentity(index, registration.activeFromEpoch);
  return { revoked, index, commitment, registration, pending: registration.ok };
}

/** Gate 4 (attack-z2-3 #4): THE RECOVERY SCAN. A recovered device (index
 * file gone) walks its branches against the validator's registration state
 * — the first index whose commitment is registered and unrevoked is the
 * identity; the first unregistered index after the last registered one is
 * a fresh start. Bounded; public reads only. */
export async function recoverIdentityIndex(mode: ZkMode = ZK_MODE, maxIndex = 1024): Promise<{ index: number; found: "active" | "fresh"; scanned: number }> {
  const { zkCommitmentAt, resetZkIdentityCache } = await import("./identity");
  const { setZkIdentityIndex } = await import("@/lib/identity/keystore");
  let lastRegistered = -1;
  for (let i = 0; i <= maxIndex; i++) {
    const c = zkCommitmentAt(i);
    const res = await fetch(`${VALIDATOR_URL}/zk/registration?mode=${mode}&commitment=${encodeURIComponent(c)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`recovery scan: registration lookup HTTP ${res.status}`);
    const j = (await res.json()) as { registered: boolean; revokedFromEpoch?: number | null };
    if (!j.registered) {
      const index = lastRegistered + 1;
      setZkIdentityIndex(index);
      resetZkIdentityCache();
      return { index, found: "fresh", scanned: i + 1 };
    }
    lastRegistered = i;
    if (j.revokedFromEpoch === null || j.revokedFromEpoch === undefined) {
      setZkIdentityIndex(i);
      resetZkIdentityCache();
      return { index: i, found: "active", scanned: i + 1 };
    }
  }
  throw new Error("recovery scan: no unrevoked branch within " + maxIndex + " indices");
}
