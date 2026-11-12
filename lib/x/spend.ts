import "server-only";
// THE SPEND LEDGER — the first file in this codebase where a bug costs real
// money, so the discipline is structural, mirror-image of the escrow ledger:
//
//   1. Every API call that costs money records through THIS file. A grep in
//      the safety suite pins spend mutations to this one module.
//   2. Caps are checked BEFORE the call, and a cap hit REFUSES LOUDLY —
//      never queue-and-retry-later (a retried send after a cap is a
//      surprise post).
//   3. Publishes carry idempotency keys: a retry after a timeout converges
//      to the SAME external ref, never a second post. Where the platform
//      cannot guarantee it, the rule is check-before-retry: consult the
//      recorded outcome before any second attempt.
//
// Fixture mode runs the IDENTICAL ledger mechanics (caps enforce on
// estimated cost, entries record with mode "fixture") — real spend is the
// sum of mode:"live" entries, and in this pass that sum is $0.00.
import { state, persistNs } from "@/lib/adapters/mock/store";
import rateCard from "./ratecard.json";
import type { CrosspostDraft, DestinationAdapter } from "@/lib/crosspost/destinations";

export const PER_ACTION_CONFIRM_USD = Number(process.env.X_SPEND_CONFIRM_ABOVE ?? 0.1);
export const PER_DAY_CAP_USD = Number(process.env.X_SPEND_DAY_CAP ?? 2);
export const PER_RUN_CAP_USD = Number(process.env.X_SPEND_RUN_CAP ?? 1);

export interface SpendEntry {
  id: string; // idempotency key — put-by-id, the Gate 0 lesson applied to money
  kind: "publish" | "delete" | "read_sync" | "fid_create" | "fid_signer" | "fid_fname";
  amount: number; // USD
  at: number;
  note: string;
  mode: "fixture" | "live";
  runId: string;
}

export class SpendCapError extends Error {
  cap: "per_action_confirm" | "per_day" | "per_run";
  constructor(cap: SpendCapError["cap"], message: string) {
    super(message);
    this.cap = cap;
  }
}

function mode(): "fixture" | "live" {
  return process.env.X_API_CLIENT_ID ? "live" : "fixture";
}

export function currentRunId(): string {
  return state().xSpendRun;
}

/** Tests mark their run so the per-run cap has a boundary. */
export async function beginSpendRun(label: string): Promise<string> {
  const s = state();
  s.xSpendRun = "run_" + label + "_" + Date.now().toString(36);
  await persistNs("xSpendRun");
  return s.xSpendRun;
}

export function spendEntries(): SpendEntry[] {
  return [...state().xSpend.values()];
}

export function spentToday(): number {
  const dayStart = new Date().setHours(0, 0, 0, 0);
  return round2(spendEntries().filter((e) => e.at >= dayStart).reduce((a, e) => a + e.amount, 0));
}

export function spentThisRun(): number {
  const run = currentRunId();
  return round2(spendEntries().filter((e) => e.runId === run).reduce((a, e) => a + e.amount, 0));
}

export function liveSpendTotal(): number {
  return round2(spendEntries().filter((e) => e.mode === "live").reduce((a, e) => a + e.amount, 0));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The cap gate. Runs BEFORE any spending call. Throws SpendCapError — the
 * caller surfaces it as a refusal, and nothing downstream runs.
 */
export function assertSpendAllowed(amount: number, confirmed: boolean): void {
  if (amount > PER_ACTION_CONFIRM_USD && !confirmed) {
    throw new SpendCapError(
      "per_action_confirm",
      `this action costs $${amount.toFixed(3)} (above $${PER_ACTION_CONFIRM_USD.toFixed(2)}) — explicit confirmation required`
    );
  }
  if (spentToday() + amount > PER_DAY_CAP_USD) {
    throw new SpendCapError(
      "per_day",
      `daily spend cap: $${spentToday().toFixed(2)} spent of $${PER_DAY_CAP_USD.toFixed(2)} — refusing, not queueing`
    );
  }
  if (spentThisRun() + amount > PER_RUN_CAP_USD) {
    throw new SpendCapError(
      "per_run",
      `per-run spend cap: $${spentThisRun().toFixed(2)} spent of $${PER_RUN_CAP_USD.toFixed(2)} — refusing, not queueing`
    );
  }
}

/** Record a spend that HAPPENED. Put-by-id: the same idempotency key never
 * records twice. The only write path to the spend ledger. */
async function recordSpend(entry: Omit<SpendEntry, "at" | "mode" | "runId">, forcedMode?: "fixture" | "live"): Promise<SpendEntry> {
  const s = state();
  const existing = s.xSpend.get(entry.id);
  if (existing) return existing;
  const full: SpendEntry = { ...entry, at: Date.now(), mode: forcedMode ?? mode(), runId: currentRunId() };
  s.xSpend.set(full.id, full);
  await persistNs("xSpend");
  return full;
}

// ---------------------------------------------------------------- MULTI-FID PASS Gate 1: fid acquisition rides the SAME ledger
/** hard cap for real spend on persona fids across the whole pass (the prompt's $10) */
// MULTI-FID Gate 5 (attack-fid-3 #9): the prompt's $10 is a CEILING, never a default an env line can raise; a
// non-number never opens the gate
//
// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE, caps): the owner may want more than two persona accounts, so the ceiling
// itself is now an explicit, separately named, BOUNDED override — LAYERS_FID_SPEND_CAP_USD, never above
// FID_SPEND_CAP_HARD_MAX_USD — and FID_SPEND_CAP_USD keeps its old meaning (it can only LOWER the cap). Defaults are
// unchanged ($10). A non-number, zero or negative value never opens anything: it falls back to the default. The
// acquisition command (scripts/fid-acquire.mjs) reads the same override from ITS environment and refuses when the app
// reports a higher cap than it would allow, so raising the cap takes the owner setting it in both places.
export const FID_SPEND_CAP_HARD_MAX_USD = 25;

/** a positive numeric env override, clamped to [floor, max]; anything unparseable or <= 0 is the default */
export function boundedEnvNumber(raw: string | undefined, def: number, max: number, opts: { integer?: boolean; floor?: number } = {}): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n) || n <= 0) return def;
  const v = opts.integer ? Math.floor(n) : n;
  if (v <= 0) return def;
  return Math.min(max, Math.max(opts.floor ?? 0, v));
}
const fidCapCeiling = boundedEnvNumber(process.env.LAYERS_FID_SPEND_CAP_USD, 10, FID_SPEND_CAP_HARD_MAX_USD);
const capEnv = Number(process.env.FID_SPEND_CAP_USD ?? fidCapCeiling);
export const FID_SPEND_CAP_USD = Number.isFinite(capEnv) && capEnv > 0 ? Math.min(fidCapCeiling, capEnv) : fidCapCeiling;
const FID_KINDS: ReadonlySet<SpendEntry["kind"]> = new Set(["fid_create", "fid_signer", "fid_fname"]);

export function fidSpendEntries(): SpendEntry[] {
  return spendEntries().filter((e) => FID_KINDS.has(e.kind));
}

/** real money spent on fids so far (live entries only; fixture entries are $0 by construction) */
export function fidSpentLive(): number {
  return round3(fidSpendEntries().filter((e) => e.mode === "live").reduce((a, e) => a + e.amount, 0));
}

/** the pass's cap, checked BEFORE any billable call by the user's acquisition command */
export function assertFidSpendAllowed(amount: number): void {
  if (fidSpentLive() + amount > FID_SPEND_CAP_USD) {
    throw new SpendCapError("per_run", `fid spend cap: ${fidSpentLive().toFixed(2)} spent of ${FID_SPEND_CAP_USD.toFixed(2)}, this step ${amount.toFixed(2)} — refusing, not queueing`);
  }
}

/** record a fid-related spend (fixture: $0 with the estimate in the note; live: the itemized cost) */
export async function recordFidSpend(entry: { id: string; kind: "fid_create" | "fid_signer" | "fid_fname"; amount: number; note: string }, mode: "fixture" | "live"): Promise<SpendEntry> {
  if (!FID_KINDS.has(entry.kind)) throw new Error("not a fid spend kind");
  if (mode === "fixture" && entry.amount !== 0) throw new Error("a fixture fid entry never records real money");
  if (mode === "live") assertFidSpendAllowed(entry.amount);
  return recordSpend({ id: entry.id, kind: entry.kind, amount: Math.round(entry.amount * 100) / 100, note: entry.note }, mode);
}

/**
 * Guarded publish: the only path to a costed X publish.
 *
 *   cost estimate → cap gate → idempotency check → publish → record ref +
 *   spend
 *
 * Retry semantics (check-before-retry): the idempotency key resolves to the
 * recorded external ref if the post already landed — a retry after a lost
 * response returns the SAME ref with no second post and no second spend. A
 * failure BEFORE the ref was recorded means the post did not land (the
 * fixture's failure semantics are fail-before-mutate; a live adapter would
 * query for the just-attempted post here) and the retry may proceed.
 */
export async function guardedPublish(
  dest: DestinationAdapter,
  draft: CrosspostDraft,
  opts: { idempotencyKey: string; confirmed: boolean }
): Promise<{ externalRef: string; cost: number; deduped: boolean }> {
  const s = state();
  const already = s.xPublished.get(opts.idempotencyKey);
  if (already) {
    // landed on a previous attempt — same ref, no second post, no second spend
    return { externalRef: already, cost: 0, deduped: true };
  }
  const { amount } = await dest.costEstimate(draft);
  assertSpendAllowed(amount, opts.confirmed);
  const { externalRef } = await dest.publish(draft);
  s.xPublished.set(opts.idempotencyKey, externalRef);
  await persistNs("xPublished");
  await recordSpend({
    id: "spend:" + opts.idempotencyKey,
    kind: "publish",
    amount,
    note: `publish to ${dest.id} (${draft.links.length ? "link post" : "plain"})`,
  });
  return { externalRef, cost: amount, deduped: false };
}

/** Costed read (owned-reads sync). Same gate, same ledger. */
export async function guardedRead(input: {
  idempotencyKey: string;
  requests: number;
  note: string;
}): Promise<{ cost: number }> {
  const amount = round3(input.requests * rateCard.readPerRequest);
  assertSpendAllowed(amount, true); // reads are sub-confirm-threshold by construction
  await recordSpend({
    id: "spend:" + input.idempotencyKey,
    kind: "read_sync",
    amount,
    note: input.note,
  });
  return { cost: amount };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** MULTI-FID Gate 5 (D-FID-5-RESET-KEEPS-MONEY): the LIVE spend entries a seed reset preserved are written back
 * HERE — every write to the ledger's map stays in this module (x3 #7 pins it); the store hands them over. */
export async function restoreLiveSpendEntries(entries: SpendEntry[]): Promise<void> {
  const live = entries.filter((e) => e.mode === "live");
  if (!live.length) return;
  const s = state();
  for (const e of live) s.xSpend.set(e.id, e);
  await persistNs("xSpend");
}
