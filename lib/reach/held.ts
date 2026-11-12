import "server-only";
// PERSONA LAUNCH P5 — WHICH REACH TIERS THIS ROOT HOLDS: the reach trees it has an ACTIVE issuance for, read from its
// own attestation vault (lib/attest/vault.ts — the sealed record every issuance is stored in), never from the validator.
//
// WHY A CACHE OF ITS OWN: the compose gate (lib/zk/gate.ts requestAnonPost) must judge a chosen tree WITHOUT a request
// at compose time — a read at the moment Post is pressed would be the beacon the wanted set exists to avoid. So the
// answer is computed at moments that are not a compose: the composer's status read when it mounts (GET /api/anon), the
// reach page (GET /api/reach), and an issuance (which knows what it was just issued). The gate reads only this cache;
// an empty or stale cache refuses a reach tree (fail toward less), it never fetches.
//
// ACTIVE = the issuance's window has started (issueWindowStart(issueEpoch) <= epoch, the validator's batching) and it
// has not expired (epoch < expiryEpoch). A renewal replaces the vault's record with a later issue epoch, so for one
// epoch after a renewal the client may think a tier not yet active that the validator kept active — it refuses then,
// and the next epoch it holds again (toward less, never more).
import type { ZkMode } from "@/lib/zk/config";
import { parseReachTree, reachTreeOf } from "./trees";

interface HeldItem {
  issuer: string;
  bucket: string;
  /** the first epoch the leaf is in the tree */
  activeFrom: number;
  expiry: number;
}
interface HeldCache {
  mode: ZkMode;
  items: HeldItem[];
  at: number;
  error: string | null;
}
const g = globalThis as unknown as { __layersReachHeld?: Partial<Record<ZkMode, HeldCache>> };
const cache = () => (g.__layersReachHeld ??= {});

function fromIssued(list: ReadonlyArray<{ issuerId: string; bucket: string; issueEpoch: number; expiryEpoch: number }>, windowStart: (e: number) => number): HeldItem[] {
  const out: HeldItem[] = [];
  for (const a of list) {
    const t = parseReachTree(reachTreeOf(a.issuerId, a.bucket));
    if (!t || !Number.isInteger(a.issueEpoch) || !Number.isInteger(a.expiryEpoch)) continue;
    out.push({ issuer: t.issuer, bucket: t.bucket, activeFrom: windowStart(a.issueEpoch), expiry: a.expiryEpoch });
  }
  return out;
}

/** the reach trees held at `epoch`, from the cache only (no read of any kind). Empty when never refreshed. */
export function heldReachTrees(mode: ZkMode, epoch: number | null | undefined): string[] {
  const c = cache()[mode];
  if (!c || typeof epoch !== "number" || !Number.isInteger(epoch)) return [];
  const out = new Set<string>();
  for (const i of c.items) if (i.activeFrom <= epoch && epoch < i.expiry) out.add(reachTreeOf(i.issuer, i.bucket));
  return [...out];
}

/** re-read the vault (the composer's mount, the reach page, never a compose). An unreadable vault leaves NOTHING held
 *  (the vault's own reads answer none on an unreadable record), and says so in `error`. */
export async function refreshHeldReach(mode: ZkMode): Promise<{ trees: (epoch: number | null | undefined) => string[]; error: string | null }> {
  let error: string | null = null;
  let items: HeldItem[] = [];
  try {
    const { myAttestations } = await import("@/lib/attest/vault");
    const { issueWindowStart } = await import("@/lib/attest/canonical");
    items = fromIssued(await myAttestations(mode), issueWindowStart);
  } catch (e) {
    error = "couldn't read your proven tiers (" + (e as Error).message + ")";
    items = [];
  }
  cache()[mode] = { mode, items, at: Date.now(), error };
  return { trees: (epoch) => heldReachTrees(mode, epoch), error };
}

/** an issuance just landed: what it issued is held from its activation epoch (merged over the cached items) */
export async function noteReachIssued(mode: ZkMode, issued: ReadonlyArray<{ issuerId: string; bucket: string; issueEpoch: number; expiryEpoch: number }>): Promise<void> {
  const { issueWindowStart } = await import("@/lib/attest/canonical");
  const fresh = fromIssued(issued, issueWindowStart);
  if (!fresh.length) return;
  const prev = cache()[mode]?.items ?? [];
  const key = (i: HeldItem) => i.issuer + "/" + i.bucket;
  const keep = new Map(prev.map((i) => [key(i), i]));
  for (const i of fresh) keep.set(key(i), i);
  cache()[mode] = { mode, items: [...keep.values()], at: Date.now(), error: null };
}

/** when the cache was last filled, and whether that read failed (the status surfaces) */
export function heldReachStatus(mode: ZkMode): { at: number | null; error: string | null } {
  const c = cache()[mode];
  return { at: c?.at ?? null, error: c?.error ?? null };
}

/** resetSeed / reloadIdentity / resetZk: the issuances this cache described belong to a wiped universe or another root.
 *  The rig's fixture knobs for reach (a fid's followers/score, an X follower count) are disarmed with it — a knob armed
 *  by one suite must never shape the next (the ops lesson). */
export function resetReachCaches(): void {
  g.__layersReachHeld = {};
  const gg = globalThis as unknown as { __layersFidFactsOverrides?: Map<number, unknown>; __layersXReachOverrides?: Map<number, unknown> };
  gg.__layersFidFactsOverrides?.clear();
  gg.__layersXReachOverrides?.clear();
}
