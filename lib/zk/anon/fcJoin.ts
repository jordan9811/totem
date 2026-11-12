import "server-only";
// PUBLIC GO-LIVE (the relay track) — JOINING THE LIVE ANONYMOUS CROWD WITH A VERIFIED SIGN IN WITH FARCASTER
// (D-PUBLIC-LIVE-TREE).
//
// Why: the public @anon is shared by strangers, so the crowd an anonymous post hides in must be people, not browser tabs (a
// fresh tab costs nothing; a Farcaster account does). With the fid gate on (the public validator), the LIVE public tree is
// one commitment per Farcaster account: the validator adds a commitment when the device shows it a Sign in with Farcaster
// that it can check itself (validator/anonpublic.js fidJoin).
//
// WHICH COMMITMENT (PRIV-LIVE-1): NOT the root's zk commitment. That one is registered under the root at boot
// (lib/zk/prefetch.ts startLiveUniverseAtBoot → /zk/register stores commitment → root), so joining the crowd with it gave the
// validator fid → commitment → root. The crowd is joined with a DEDICATED identity instead:
//   master_fid = HKDF-SHA256(ikm = this root's current zk master, salt = empty, info = "layers/anon-fid-tree/1"), 32 bytes
//   → a stock Semaphore v4 Identity (EdDSA-Poseidon), commitment = Poseidon(pubkey)
// It is NEVER registered (nothing here or anywhere calls registerCommitment with it), it proves the live gated plain tree
// only (anonMembershipFor / proverIdentityFor below, read by lib/zk/prove.ts and lib/zk/transport/browser.ts), and it
// follows the zk master's branch (a re-issued identity is a new crowd identity too). A linked device derives the same one
// from the master it was given. What the validator learns at join, named (R6): this Farcaster account holds a commitment
// that no table of its own ties to a root — never which posts are whose.
//
// How the commitment is bound to the sign-in: the SIWF nonce is not random here — it is joinNonceFor(commitment, salt), 16
// base62 characters of sha256("layers-anon-fid-join/1|" + commitment + "|" + salt) with a fresh 16-byte salt (a DELIBERATE
// DUPLICATE of validator/anonpublic.js joinNonceFor; scripts/unit-anon-relay.mjs pins the pair). So the Farcaster relay or
// app, which see the signed message, cannot use it to join a DIFFERENT commitment (and so cannot take this person's leaf);
// the nonce alone says nothing about the commitment without the salt, which only the join request carries.
//
// When: only while the app hands this tab the LIVE universe (lib/zk/anon/universe.ts); lib/fc/siwf/flow.ts asks
// fcJoinNonce() when a sign-in starts and calls fcJoinAfterSignIn() once the sign-in is verified AND recorded (PRIV-LIVE-3:
// a sign-in Totem then refuses never tells the validator the account). Fire and forget: a join that fails never fails the
// sign-in; it is retried a few times (a chain read the validator could not make) within the sign-in's freshness, then said
// plainly (availability.ts ANON_LIVE_JOIN_FAILED).
//
// LEAVING (ASM-5): fcLeaveCrowd() signs a leave with the dedicated identity's own key; the validator checks the key hashes
// to the commitment and marks it left from the next epoch (validator/anonpublic.js fidLeave). Joining again takes a fresh
// Sign in with Farcaster.
//
// CONFINEMENT, as lib/zk/identity.ts confines the root identity: what leaves this module is the COMMITMENT (public by
// design) and booleans; the master, the secret scalar and the private key never leave it except to the in-tab prover
// (anonFidTreeSecretScalarForProver / anonFidTreeMasterHexForProver: the transport modules only) and the leak grep's needle
// list (anonFidTreeMaterialForLeakTest). MEMORY ONLY: the salt, the signed message and the join's outcome live in this tab
// and nowhere else (after a reload the commitment simply shows up as a leaf from its first window).
import { sha256 } from "@noble/hashes/sha2";
import { hkdf } from "@noble/hashes/hkdf";
import { Identity } from "@semaphore-protocol/identity";
// a NAMESPACE import: a harness that mocks the keystore without zkMasterBytes still builds (the call then throws, and the
// callers treat an unreadable crowd identity as a refusal on the gated tree, never as the root)
import * as keystore from "@/lib/identity/keystore";
import type { AnonJoinState } from "./availability";

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEX = "0123456789abcdef";
const hex = (b: Uint8Array) => Array.from(b, (x) => HEX[x >> 4] + HEX[x & 15]).join("");

/** PURE: the SIWF nonce that binds a commitment (see the header) */
export function joinNonceFor(commitment: string, salt: string): string {
  const d = sha256(new TextEncoder().encode("layers-anon-fid-join/1|" + commitment + "|" + salt));
  let out = "";
  for (let i = 0; i < 16; i++) out += B62[d[i] % 62];
  return out;
}

// ------------------------------------------------------------------------------------------------ the dedicated identity
/** the HKDF info of the crowd identity (PRIV-LIVE-1): its own branch, so it never equals any other key this root holds */
export const ANON_FID_TREE_INFO = "layers/anon-fid-tree/1";

/** PURE: the crowd identity's master for a given zk master (the harness pins the derivation with it) */
export function anonFidTreeMasterFor(zkMaster: Uint8Array): Uint8Array {
  if (!(zkMaster instanceof Uint8Array) || zkMaster.length !== 32) throw new Error("anon crowd identity: the zk master must be 32 bytes");
  return hkdf(sha256, zkMaster, new Uint8Array(0), new TextEncoder().encode(ANON_FID_TREE_INFO), 32);
}

// cached per zk master (a recovery or a re-issued branch changes the master: a stale identity would prove as the old one)
let cached: { key: string; master: Uint8Array; identity: Identity } | null = null;
function crowdIdentity(): { master: Uint8Array; identity: Identity } {
  if (typeof keystore.zkMasterBytes !== "function") throw new Error("no zk master on this device");
  const zk = keystore.zkMasterBytes();
  const key = hex(sha256(zk));
  if (cached && cached.key === key) return cached;
  const master = anonFidTreeMasterFor(zk);
  cached = { key, master, identity: new Identity(master) };
  return cached;
}

/** the crowd identity's PUBLIC commitment (decimal) — what a Farcaster join adds to the live gated tree */
export function anonFidTreeCommitment(): string {
  return crowdIdentity().identity.commitment.toString(10);
}

/** CONFINED — the transport modules only (lib/zk/transport/browser.ts): the crowd identity's secret scalar, handed to the
 *  in-tab prover for one job. Never serialized, logged or returned by a route. */
export function anonFidTreeSecretScalarForProver(): bigint {
  return crowdIdentity().identity.secretScalar;
}

/** CONFINED — a server-side live transport only (lib/zk/transport/live.ts hands the worker a master, never a scalar) */
export function anonFidTreeMasterHexForProver(): string {
  return hex(crowdIdentity().master);
}

/** EVERY encoding of the crowd identity's secret material the leak grep must hunt (beside lib/zk/identity.ts's own list) */
export function anonFidTreeMaterialForLeakTest(): string[] {
  const { master, identity } = crowdIdentity();
  const priv = identity.privateKey;
  const privBytes = typeof priv === "string" ? new TextEncoder().encode(priv) : new Uint8Array(priv);
  return [hex(master), identity.secretScalar.toString(10), identity.secretScalar.toString(16), identity.export(), hex(privBytes)];
}

// ------------------------------------------------------------------------------------------------ which identity proves
/** the plain sentence a gated live tree refuses a root that has not joined with Farcaster yet (prove.ts' membership step) */
export const ANON_FID_NOT_JOINED =
  "you haven't joined the anonymous crowd with Farcaster yet (sign in with Farcaster on this site; you're in from the next 6-hour window)";

export type AnonMembership = { ok: true; identity: "root" | "anon-fid-tree"; commitment: string } | { ok: false; reason: string };

/**
 * PURE (PRIV-LIVE-1): which identity proves `tree` here, and is it a leaf — lib/zk/prove.ts step 6.
 *   - the LIVE universe's plain anon tree while the validator's fid gate is on (its config said fidGate: true): the CROWD
 *     identity only — never the root's, even if the root's commitment happens to be a leaf there (anyone may join any
 *     public commitment with their own fid); not a leaf → refused, in plain words;
 *   - the live plain tree of a validator whose gate is off or did not say (an older config): the root's when it is the
 *     leaf, as before this pass (the crowd identity is not even derived then), else the crowd identity's when IT is;
 *   - every other tree and the test universe: the root identity, exactly as before.
 * `fidCommitment` is asked only for the live plain tree, and there only when it can matter (the keystore is read then).
 */
export function anonMembershipFor(o: { mode: "fixture" | "live"; tree: string; plainTree: string; members: readonly string[]; fidGate: boolean | null | undefined; rootCommitment: string; fidCommitment: () => string }): AnonMembership {
  const livePlain = o.mode === "live" && o.tree === o.plainTree;
  // ungated: the root first when it is the leaf (the crowd identity is not even derived then — as before this pass)
  if (livePlain && o.fidGate !== true && o.members.includes(o.rootCommitment)) return { ok: true, identity: "root", commitment: o.rootCommitment };
  if (livePlain) {
    let c: string | null = null;
    let unreadable: string | null = null;
    try {
      c = o.fidCommitment();
    } catch (e) {
      unreadable = String((e as Error)?.message ?? e).slice(0, 120);
    }
    if (c && o.members.includes(c)) return { ok: true, identity: "anon-fid-tree", commitment: c };
    // never the root on a gated tree (fail closed: an unreadable crowd identity is a refusal, not a fallback)
    if (o.fidGate === true) return { ok: false, reason: unreadable ? "this device's anonymous-crowd identity couldn't be read here (" + unreadable + ")" : ANON_FID_NOT_JOINED };
  }
  if (o.members.includes(o.rootCommitment)) return { ok: true, identity: "root", commitment: o.rootCommitment };
  return { ok: false, reason: "this root is not a leaf of the tree this epoch (registration is batched to the next epoch, or the tier is not met)" };
}

/**
 * PURE (PRIV-LIVE-1): the identity the in-tab prover uses for a job, and its commitment (null = unreadable: refused).
 *   - DECLARED by lib/zk/prove.ts (the product path: anonMembershipFor already chose, on the same members): that one;
 *   - undeclared (a direct caller of the transport): the root when it is a leaf or the job is not the live plain tree —
 *     the crowd identity is never even derived then — else the crowd identity when IT is the leaf.
 * `fidCommitment` is asked only when needed (it reads the keystore).
 */
export function proverIdentityFor(o: { declared?: "root" | "anon-fid-tree"; mode: "fixture" | "live"; tree: string; plainTree: string; members: readonly string[]; rootCommitment: () => string; fidCommitment: () => string | null }): { identity: "root" | "anon-fid-tree"; commitment: string | null } {
  if (o.declared === "anon-fid-tree") return { identity: "anon-fid-tree", commitment: o.fidCommitment() };
  const root = o.rootCommitment();
  if (o.declared === "root" || o.mode !== "live" || o.tree !== o.plainTree || o.members.includes(root)) return { identity: "root", commitment: root };
  const c = o.fidCommitment();
  return c && o.members.includes(c) ? { identity: "anon-fid-tree", commitment: c } : { identity: "root", commitment: root };
}

// ------------------------------------------------------------------------------------------------ the join
interface FcJoinMemory {
  /** nonce → the salt and commitment it binds (one sign-in at a time; the newest replaces the older) */
  pending: { nonce: string; salt: string; commitment: string } | null;
  /** commitment → what the last join said */
  outcomes: Map<string, AnonJoinState & { fid: number; at: number }>;
}
const g = globalThis as unknown as { __layersFcJoin?: FcJoinMemory };
const mem = (): FcJoinMemory => (g.__layersFcJoin ??= { pending: null, outcomes: new Map() });

/** a binding nonce for the sign-in about to start, or null when the crowd identity cannot be read (the caller then uses a
 *  plain random nonce, and no join is attempted). PRIV-LIVE-1: the CROWD identity's commitment, never the root's. */
export async function fcJoinNonce(): Promise<{ nonce: string; salt: string } | null> {
  try {
    const commitment = anonFidTreeCommitment();
    if (typeof commitment !== "string" || !/^\d{1,78}$/.test(commitment)) return null;
    const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const nonce = joinNonceFor(commitment, salt);
    mem().pending = { nonce, salt, commitment };
    return { nonce, salt };
  } catch {
    return null;
  }
}

const JOIN_RETRY_MS = [4_000, 15_000];

/**
 * After a VERIFIED and RECORDED sign-in whose nonce fcJoinNonce made: ask the validator to add the crowd identity's
 * commitment to the live crowd. Never throws; records the outcome for availability.ts (fcJoinState). Retried only when the
 * validator could not read the chain (503) — every other answer is final for this sign-in.
 */
export async function fcJoinAfterSignIn(i: { message: string; signature: string; fid: number; authMethod: string; nonce: string }): Promise<void> {
  const m = mem();
  const p = m.pending;
  if (!p || p.nonce !== i.nonce) return; // not a binding sign-in (the nonce was a plain random one)
  m.pending = null;
  const record = (state: AnonJoinState) => {
    m.outcomes.set(p.commitment, { ...state, fid: i.fid, at: Date.now() });
    while (m.outcomes.size > 8) m.outcomes.delete(m.outcomes.keys().next().value as string);
  };
  try {
    const { postFidJoin } = await import("@/lib/zk/validatorClient");
    for (let attempt = 0; ; attempt++) {
      let r: { status: number; json: Record<string, unknown> | null };
      try {
        r = await postFidJoin({ mode: "live", fid: i.fid, message: i.message, signature: i.signature, authMethod: i.authMethod, commitment: p.commitment, salt: p.salt });
      } catch (e) {
        r = { status: 0, json: { error: "the validator could not be reached (" + String((e as Error)?.message ?? e).slice(0, 120) + ")" } };
      }
      if ((r.status === 200 || r.status === 201) && r.json?.ok === true && typeof r.json.activeFromEpoch === "number") {
        record({ registered: true, activeFromEpoch: r.json.activeFromEpoch, error: null });
        return;
      }
      const retryable = r.status === 503 || r.status === 0;
      if (!retryable || attempt >= JOIN_RETRY_MS.length) {
        record({ registered: false, activeFromEpoch: null, error: (typeof r.json?.error === "string" ? r.json.error : "the validator answered " + r.status).slice(0, 200) });
        return;
      }
      await new Promise((res) => setTimeout(res, JOIN_RETRY_MS[attempt]));
    }
  } catch (e) {
    record({ registered: false, activeFromEpoch: null, error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}

/** what the last Farcaster join of this commitment said in this tab (null: none yet) — availability.ts's `join` for live */
export function fcJoinState(commitment: string | null): AnonJoinState | null {
  if (!commitment) return null;
  const o = mem().outcomes.get(commitment);
  return o ? { registered: o.registered, activeFromEpoch: o.activeFromEpoch, error: o.error } : null;
}

// ------------------------------------------------------------------------------------------------ leaving (ASM-5)
/** PURE: the field element a leave signs (DELIBERATE DUPLICATE of validator/anonpublic.js fidLeaveMessage):
 *  sha256("layers-anon-fid-leave/1|" + mode + "|" + commitment + "|" + issuedHour) >> 8 */
export function fidLeaveMessage(mode: "live", commitment: string, issuedHour: number): bigint {
  const d = sha256(new TextEncoder().encode(["layers-anon-fid-leave/1", mode, commitment, String(issuedHour)].join("|")));
  return BigInt("0x" + hex(d)) >> BigInt(8);
}

/** the signed leave for the crowd identity, ready to send (exported for the harness; the secret never leaves) */
export function signFidLeave(now: number = Date.now()): { mode: "live"; commitment: string; publicKey: [string, string]; signature: { R8: [string, string]; S: string }; issuedHour: number } {
  const { identity } = crowdIdentity();
  const commitment = identity.commitment.toString(10);
  const issuedHour = Math.floor(now / 3_600_000);
  const sig = identity.signMessage(fidLeaveMessage("live", commitment, issuedHour));
  const pk = identity.publicKey;
  return { mode: "live", commitment, publicKey: [String(pk[0]), String(pk[1])], signature: { R8: [String(sig.R8[0]), String(sig.R8[1])], S: String(sig.S) }, issuedHour };
}

/**
 * Leave the live anonymous crowd: the crowd identity signs a leave and the validator drops its commitment from the NEXT
 * epoch (validator/anonpublic.js fidLeave). Never throws; the answer says what happened, in plain words when refused. The
 * tab forgets its join outcome for the commitment (availability then reads "sign in with Farcaster first").
 */
export async function fcLeaveCrowd(): Promise<{ ok: boolean; status: number; leftFromEpoch: number | null; error: string | null }> {
  try {
    const body = signFidLeave();
    const { postFidLeave } = await import("@/lib/zk/validatorClient");
    const r = await postFidLeave(body);
    const ok = r.status === 200 && r.json?.ok === true;
    if (ok) mem().outcomes.delete(body.commitment);
    return { ok, status: r.status, leftFromEpoch: ok && typeof r.json?.leftFromEpoch === "number" ? (r.json.leftFromEpoch as number) : null, error: ok ? null : (typeof r.json?.error === "string" ? r.json.error : "the validator answered " + r.status).slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, leftFromEpoch: null, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** tests and resetSeed: forget the pending binding, the outcomes and the cached crowd identity */
export function resetFcJoin(): void {
  g.__layersFcJoin = { pending: null, outcomes: new Map() };
  cached = null;
}
