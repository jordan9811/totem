import "server-only";
// MEGA PASS 2 Gate 1 — THE ALLOWANCE. Per-root, per-epoch, recharging,
// and stored ONLY in the vault: the validator sees per-persona spend
// events (lib/influence/stakes.ts) and never a balance, a root, or the
// tier the allowance was computed from.
//
// Non-transferable BY CONSTRUCTION: this module has spend, refund-on-
// failed-send and recharge. There is no operation that credits a balance
// from anywhere but the epoch recharge, and no operation that names a
// second account. (lib/influence/types.ts pins that at the type level for
// the adapter contract; the Gate 1 suite greps this file.)
//
// ANTI-DRAIN: a stake cannot exceed the remaining allowance — refused,
// never overdrawn — and the recharge is per-EPOCH: a balance stamped with
// an epoch AHEAD of the validator's clock is corruption or front-loading
// and is reset to the current epoch's allowance, never honoured.
//
// Fail-closed reads, like every sealed record (anonAttribution): a read
// that fails is a refusal, never an empty document a later save could seal
// over — the balance is the only copy of what this root has left to spend.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import { zkMode } from "@/lib/zk/config";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { allowanceForTier, DEFAULT_DIRECTION, DEFAULT_STAKE, type StakeAction, type StakeDirection, type StakeEvent } from "./types";

export const VAULT_NS = "influence";

export interface Balance {
  epoch: number;
  allowance: number;
  remaining: number;
  /** the tier the allowance was computed from at recharge — legibility, never authority */
  tier: number;
}

export interface AccrualRecord {
  /** the epoch the accrual was POSTED in */
  epoch: number;
  /** the epoch whose stakes were evaluated (the delayed window: epoch - 1) */
  evaluatedEpoch: number;
  score: number;
  count: number;
  evaluated: number;
  confirmed: number;
  postedAt: number;
  sourceId: string;
}

export interface InfluenceDoc {
  balance: Balance | null;
  defaults: Partial<Record<StakeAction, number>>;
  directions: Partial<Record<StakeAction, StakeDirection>>;
  /** this root's own stake history — a mirror of what the validator holds, sealed, for the owner's own view and restart/recovery */
  mine: StakeEvent[];
  accruals: AccrualRecord[];
  loaded: boolean;
}

const g = globalThis as unknown as { __layersInfluence?: InfluenceDoc };

async function load(): Promise<InfluenceDoc> {
  if (g.__layersInfluence) return g.__layersInfluence;
  let doc: InfluenceDoc = { balance: null, defaults: {}, directions: {}, mine: [], accruals: [], loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) { doc.loaded = true; break; }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries); // throws on the wrong key: loud, never empty-as-success
        const rec = plain["_"] as { m?: Partial<InfluenceDoc> } | undefined;
        // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
        // namespace whose records are all unreadable — deleted, truncated, plaintext, or
        // sealed under a different key — became an EMPTY document marked loaded, and the next
        // write sealed that emptiness over the real record. Records present with none readable
        // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
        if (!rec)
          throw new Error(
            "vault: influence holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        const m = rec?.m ?? {};
        doc = {
          balance: m.balance && typeof m.balance === "object" ? m.balance : null,
          defaults: m.defaults && typeof m.defaults === "object" ? m.defaults : {},
          directions: m.directions && typeof m.directions === "object" ? m.directions : {},
          mine: Array.isArray(m.mine) ? m.mine : [],
          accruals: Array.isArray(m.accruals) ? m.accruals : [],
          loaded: true,
        };
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
  if (!doc.loaded) throw new Error("influence allowance unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty");
  g.__layersInfluence = doc;
  return doc;
}

async function save(doc: InfluenceDoc): Promise<void> {
  if (!doc.loaded) throw new Error("influence allowance was never loaded from the validator — refusing to seal over it");
  g.__layersInfluence = doc;
  const m = { balance: doc.balance, defaults: doc.defaults, directions: doc.directions, mine: doc.mine, accruals: doc.accruals };
  const inner = JSON.stringify(m);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  // ONE opaque padded sealed record: the length reveals neither the balance nor the history size
  const sealed = encryptNamespace(VAULT_NS, { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  await flushVault(VAULT_NS, sealed);
}

export function resetInfluenceCache(): void {
  g.__layersInfluence = undefined;
}

export class OverdrawRefusal extends Error {
  code = "overdraw" as const;
  constructor(public amount: number, public remaining: number) {
    super(`stake of ${amount} exceeds the remaining allowance (${remaining}) — refused, never overdrawn`);
  }
}

/** the device's own personas: the seeded self plus everything the keystore minted */
export async function ownPersonaIdsAll(): Promise<string[]> {
  const { SEED_VIEWER } = await import("@/lib/adapters/mock/store");
  const { ownPersonaIds } = await import("@/lib/identity/keystore");
  return [...new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])];
}

/** the tier the allowance derives from: the HIGHEST tier any of this root's
 * personas holds — under zk, what it PROVED this epoch (0 = nothing yet);
 * under the legacy bindings, the legacy tier. An unreachable rep adapter
 * THROWS: an allowance granted on a guessed tier would be a fail-open. */
export async function ownTierNow(): Promise<number> {
  const { adapters } = await import("@/lib/adapters/registry");
  const { retryAdapter } = await import("@/lib/adapters/retry");
  let best = 0;
  for (const id of await ownPersonaIdsAll()) {
    const t = await retryAdapter(() => adapters.rep.tierFor(id));
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

export async function currentEpoch(): Promise<number> {
  return (await fetchEpoch(zkMode())).epoch;
}

/** The balance for the CURRENT epoch. Recharges when the epoch has moved
 * on; a balance from a FUTURE epoch is never honoured. Never adds to a
 * balance inside an epoch: the allowance is what it was at recharge. */
export async function currentAllowance(): Promise<Balance> {
  const doc = await load();
  const epoch = await currentEpoch();
  const b = doc.balance;
  if (b && b.epoch === epoch) return b;
  // a stale balance (earlier epoch) recharges; a FUTURE-stamped one is corruption or front-loading — reset, never honoured
  const tier = await ownTierNow();
  const allowance = allowanceForTier(tier);
  doc.balance = { epoch, allowance, remaining: allowance, tier };
  await save(doc);
  return doc.balance;
}

/** reserve `amount` of the current epoch's allowance, or refuse */
export async function reserveStake(amount: number): Promise<Balance> {
  const b = await currentAllowance();
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("stake amount must be a positive integer");
  if (amount > b.remaining) throw new OverdrawRefusal(amount, b.remaining);
  const doc = await load();
  doc.balance = { ...b, remaining: b.remaining - amount };
  await save(doc);
  return doc.balance;
}

/** put a reservation back when the validator refused the send — same epoch only, never above the allowance */
export async function refundStake(amount: number, epoch: number): Promise<void> {
  const doc = await load();
  const b = doc.balance;
  if (!b || b.epoch !== epoch) return;
  doc.balance = { ...b, remaining: Math.min(b.allowance, b.remaining + amount) };
  await save(doc);
}

export async function recordOwnStake(e: StakeEvent): Promise<void> {
  const doc = await load();
  if (!doc.mine.some((x) => x.id === e.id)) doc.mine.push(e);
  if (doc.mine.length > 2000) doc.mine = doc.mine.slice(-2000);
  await save(doc);
}

export async function ownStakes(): Promise<StakeEvent[]> {
  return [...(await load()).mine];
}

export interface StakeSettings {
  defaults: Record<StakeAction, number>;
  directions: Record<StakeAction, StakeDirection>;
}

export async function stakeSettings(): Promise<StakeSettings> {
  const doc = await load();
  return {
    defaults: { ...DEFAULT_STAKE, ...doc.defaults },
    directions: { ...DEFAULT_DIRECTION, ...doc.directions },
  };
}

export async function setStakeSettings(patch: { defaults?: Partial<Record<StakeAction, number>>; directions?: Partial<Record<StakeAction, StakeDirection>> }): Promise<StakeSettings> {
  const doc = await load();
  doc.defaults = { ...doc.defaults, ...(patch.defaults ?? {}) };
  doc.directions = { ...doc.directions, ...(patch.directions ?? {}) };
  await save(doc);
  return stakeSettings();
}

export async function recordAccrual(rec: AccrualRecord): Promise<void> {
  const doc = await load();
  if (doc.accruals.some((a) => a.sourceId === rec.sourceId)) return;
  doc.accruals.push(rec);
  await save(doc);
}

export async function accruals(): Promise<AccrualRecord[]> {
  return [...(await load()).accruals];
}
