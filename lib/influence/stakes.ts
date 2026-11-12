import "server-only";
// MEGA PASS 2 Gate 1 — STAKES: spend allowance as a signed, public,
// per-persona signal on a cast.
//
// The flow, in order, so nothing is ever spent on a stake the network did
// not take and nothing the network took is ever unaccounted for:
//   1. the acting persona must be one of this device's own (the same rule
//      every other own-persona action uses);
//   2. the amount is checked against the CURRENT epoch's remaining
//      allowance and RESERVED (lib/influence/allowance.ts refuses an
//      overdraw — there is no negative balance, ever);
//   3. the event is signed with the PERSONA's existing key over a canonical
//      form the validator re-derives (a DELIBERATE DUPLICATE in
//      validator/stakes.js) and sent; a refusal REFUNDS the reservation;
//   4. the accepted event is mirrored into the vault (the owner's own
//      history, sealed) — the validator's copy is the public one.
//
// What the validator learns: {persona, cast, action, direction, amount,
// epoch, hour} — per-persona spend events, exactly what the mechanic
// needs for legibility, and NOTHING about the root, the balance or the
// tier (SECURITY-POSTURE §15). Rows are re-verified at every read against
// the persona's resolved key: an unverifiable row is treated as absent.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { validatorUrl } from "@/lib/ports";
import { zkMode, type ZkMode } from "@/lib/zk/config";
import { publicKeyForPersona, signForPersona } from "@/lib/identity/keys";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import {
  currentAllowance,
  OverdrawRefusal,
  ownPersonaIdsAll,
  recordOwnStake,
  refundStake,
  reserveStake,
  stakeSettings,
} from "./allowance";
import {
  emptySummary,
  isStakeAction,
  isStakeDirection,
  MAX_STAKE_PER_EVENT,
  stakeCanonical,
  type CastStakeSummary,
  type StakeAction,
  type StakeBody,
  type StakeDirection,
  type StakeEvent,
} from "./types";

const CAST_RE = /^[A-Za-z0-9_:#.x-]{1,120}$/;

export function stakeIdOf(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24);
}

export interface PlaceStakeInput {
  personaId: string;
  castHash: string;
  action: StakeAction;
  direction?: StakeDirection;
  amount?: number;
}

export type PlaceStakeResult =
  | { ok: true; stake: StakeEvent | null; remaining: number; allowance: number; epoch: number }
  | { ok: false; code: "not_own" | "malformed" | "overdraw" | "unsigned" | "refused" | "unavailable"; reason: string; remaining?: number; allowance?: number };

/** Place a stake. A zero amount (the user's setting, or an explicit 0) is a
 * valid answer: the underlying action stands, nothing is staked, nothing
 * is sent. Refusals are typed and never throw — callers on an action route
 * report them beside the action's own success. */
export async function placeStake(input: PlaceStakeInput): Promise<PlaceStakeResult> {
  const { personaId, castHash, action } = input;
  if (!isStakeAction(action)) return { ok: false, code: "malformed", reason: "unknown stake action" };
  if (!CAST_RE.test(castHash)) return { ok: false, code: "malformed", reason: "castHash malformed" };
  if (!(await ownPersonaIdsAll()).includes(personaId)) return { ok: false, code: "not_own", reason: "not one of your personas — a stake is spent from your own allowance, as your own persona" };
  const settings = await stakeSettings();
  const amount = input.amount ?? settings.defaults[action];
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_STAKE_PER_EVENT) return { ok: false, code: "malformed", reason: `stake amount must be an integer 0..${MAX_STAKE_PER_EVENT}` };
  const direction = input.direction ?? settings.directions[action];
  if (!isStakeDirection(direction)) return { ok: false, code: "malformed", reason: "unknown stake direction" };
  let balance;
  try {
    balance = await currentAllowance();
  } catch (e) {
    return { ok: false, code: "unavailable", reason: (e as Error).message };
  }
  if (amount === 0) return { ok: true, stake: null, remaining: balance.remaining, allowance: balance.allowance, epoch: balance.epoch };
  const mode = zkMode();
  const body: StakeBody = { mode, personaId, castHash, action, direction, amount, epoch: balance.epoch, nonce: randomBytes(8).toString("hex") };
  const canonical = stakeCanonical(body);
  const signature = signForPersona(personaId, canonical);
  const pubkey = publicKeyForPersona(personaId);
  if (!signature || !pubkey) return { ok: false, code: "unsigned", reason: "no signing key resolves for this persona — an unsigned stake is never sent" };
  // reserve BEFORE the send, refund on refusal: the balance never goes negative and never pays for a stake the validator did not take
  try {
    balance = await reserveStake(amount);
  } catch (e) {
    if (e instanceof OverdrawRefusal) return { ok: false, code: "overdraw", reason: e.message, remaining: e.remaining, allowance: balance.allowance };
    return { ok: false, code: "unavailable", reason: (e as Error).message };
  }
  let res: Response;
  try {
    res = await fetch(`${validatorUrl()}/stakes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, pubkey, signature }),
      cache: "no-store",
    });
  } catch (e) {
    await refundStake(amount, body.epoch);
    return { ok: false, code: "unavailable", reason: "validator unreachable: " + (e as Error).message };
  }
  const json = (await res.json().catch(() => null)) as { error?: string; stake?: StakeEvent } | null;
  if (!res.ok || !json?.stake) {
    await refundStake(amount, body.epoch);
    return { ok: false, code: "refused", reason: json?.error ?? `validator refused (${res.status})` };
  }
  await recordOwnStake(json.stake);
  return { ok: true, stake: json.stake, remaining: balance.remaining, allowance: balance.allowance, epoch: balance.epoch };
}

// ---------------------------------------------------------------- reads

/** a row is a stake only if its signature verifies under the key THIS
 * client resolves for the persona — the validator's copy of the pubkey is
 * carried for remote readers and checked here too (must match) */
export function verifyStakeRow(row: StakeEvent): boolean {
  if (!isStakeAction(row.action) || !isStakeDirection(row.direction)) return false;
  if (!Number.isInteger(row.amount) || row.amount <= 0 || row.amount > MAX_STAKE_PER_EVENT) return false;
  const expected = publicKeyForPersona(row.personaId);
  if (!expected || expected.toLowerCase() !== String(row.pubkey).toLowerCase()) return false;
  const canonical = stakeCanonical({ mode: row.mode, personaId: row.personaId, castHash: row.castHash, action: row.action, direction: row.direction, amount: row.amount, epoch: row.epoch, nonce: row.nonce });
  return verifyCanonical(row.signature, canonical, expected);
}

async function fetchRows(query: string): Promise<StakeEvent[]> {
  let last: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${validatorUrl()}/stakes?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error("validator answered " + res.status);
      const json = (await res.json()) as { stakes?: StakeEvent[] };
      const rows = (Array.isArray(json.stakes) ? json.stakes : []).filter(verifyStakeRow);
      // LAYERS_WORLD=empty (review WORLD-LEAK-5): the validator's stake table is not an adapter_state namespace, so
      // the store's partition never sees it — the demo world's seeded stakes (persona_acc_crypto_4/5/6's coordinated
      // cluster, signed by fixture personas on an earlier demo boot) are dropped HERE, at the one read every view
      // (clusters, cast summaries, recent stakes, history) goes through: a row is kept only when its persona is one
      // of this device's real ones (the same allowlist the store partitions by). The rows stay on the validator.
      const { isEmptyWorld, realPersonaIds } = await import("@/lib/world");
      if (isEmptyWorld()) {
        const real = new Set(realPersonaIds());
        return rows.filter((r) => real.has(r.personaId));
      }
      return rows;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw new Error("stakes unavailable: " + ((last as Error)?.message ?? "unreachable"));
}

export async function stakesForCast(castHash: string, mode: ZkMode = zkMode()): Promise<StakeEvent[]> {
  return fetchRows(`mode=${mode}&castHash=${encodeURIComponent(castHash)}`);
}

/** the public rows of the current epoch and the `back` epochs before it — ONE read per feed build */
export async function recentStakes(back = 2, mode: ZkMode = zkMode()): Promise<StakeEvent[]> {
  return fetchRows(`mode=${mode}&recentEpochs=${Math.max(0, Math.min(12, back))}`);
}

export async function stakesInEpoch(epoch: number, mode: ZkMode = zkMode()): Promise<StakeEvent[]> {
  return fetchRows(`mode=${mode}&epoch=${Math.max(0, Math.floor(epoch))}`);
}

/** the rows a persona signed — the RAW read; the disclosure decision is historyFor()'s */
async function rowsOfPersona(personaId: string, mode: ZkMode = zkMode()): Promise<StakeEvent[]> {
  return fetchRows(`mode=${mode}&personaId=${encodeURIComponent(personaId)}`);
}

export type HistoryResult =
  | { ok: true; own: boolean; stakes: StakeEvent[] }
  | { ok: false; code: "forbidden" | "unavailable"; reason: string };

/** LEGIBILITY AT THE OWNER'S DISCLOSURE LEVEL. The owner always sees their
 * own history; anyone else sees it only if the persona's EXISTING
 * disclosure grant admits them (the same level that governs its linkage
 * surface — one setting, not two). FAIL CLOSED: a disclosure read that
 * fails is a refusal, never the history. */
export async function historyFor(personaId: string, viewerPersonaId: string): Promise<HistoryResult> {
  const own = (await ownPersonaIdsAll()).includes(personaId) && (await ownPersonaIdsAll()).includes(viewerPersonaId);
  if (!own) {
    let allowed = false;
    try {
      const { adapters } = await import("@/lib/adapters/registry");
      const { retryAdapter } = await import("@/lib/adapters/retry");
      allowed = await retryAdapter(() => adapters.disclosure.canViewLinkage(personaId, viewerPersonaId));
    } catch (e) {
      return { ok: false, code: "unavailable", reason: "disclosure could not be checked — refusing rather than guessing: " + (e as Error).message };
    }
    if (!allowed) return { ok: false, code: "forbidden", reason: "this persona's stake history is not disclosed to you (its disclosure level decides)" };
  }
  try {
    return { ok: true, own, stakes: await rowsOfPersona(personaId) };
  } catch (e) {
    return { ok: false, code: "unavailable", reason: (e as Error).message };
  }
}

/** aggregate verified rows per cast */
export function summarize(rows: StakeEvent[], viewerPersonaIds: ReadonlySet<string> = new Set()): Map<string, CastStakeSummary> {
  const out = new Map<string, CastStakeSummary>();
  const stakers = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = out.get(r.castHash) ?? emptySummary();
    s.total += r.amount;
    s.byDirection[r.direction] += r.amount;
    if (viewerPersonaIds.has(r.personaId)) s.viewerStaked = (s.viewerStaked ?? 0) + r.amount;
    const set = stakers.get(r.castHash) ?? new Set<string>();
    set.add(r.personaId);
    stakers.set(r.castHash, set);
    s.stakers = set.size;
    out.set(r.castHash, s);
  }
  return out;
}

/** distinct personas holding a `note-worthy` stake on each cast — the
 * stake-backed half of the community-notes endorsement gate */
export function noteWorthyStakersByCast(rows: StakeEvent[]): Map<string, number> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.direction !== "note-worthy") continue;
    const set = m.get(r.castHash) ?? new Set<string>();
    set.add(r.personaId);
    m.set(r.castHash, set);
  }
  return new Map([...m].map(([k, v]) => [k, v.size]));
}
