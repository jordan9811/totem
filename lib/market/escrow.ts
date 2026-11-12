import "server-only";
// THE ESCROW LEDGER — the money invariant lives here, structurally.
//
// Every escrowed amount resolves to EXACTLY ONE terminal state: settled,
// refunded, or lottery. That is not a policy the four InfoFi features each
// promise to uphold — it is a property of this ledger:
//
//   1. Funds move only through hold() and resolve(). There is no other
//      mutation path, and a grep in the acceptance suite keeps it that way.
//   2. resolve() THROWS on an already-resolved escrow. A double-settle or a
//      settle-after-refund is a loud error, never a silent second payout.
//   3. Conservation is checkable: sum(balances) + sum(held) is constant
//      across any sequence of operations, and the safety-set test asserts
//      it under injected adapter failures.
//
// Mock money: every persona starts with 1,000 USDC-flavoured units.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs } from "@/lib/adapters/mock/store";
import { marketClock } from "@/lib/adapters/mock/clock";

export type EscrowKind = "paid_read" | "dm" | "pledge" | "channel_tip";
export type EscrowTerminal = "settled" | "refunded" | "lottery";
export type EscrowStatus = "held" | EscrowTerminal;

export interface Escrow {
  id: string;
  kind: EscrowKind;
  fromPersona: string;
  amount: number;
  createdAt: number;
  windowMs: number;
  status: EscrowStatus;
  /** who the funds went to, for terminal states that pay someone */
  resolvedTo?: string;
  resolvedAt?: number;
}

export const STARTING_BALANCE = 1000;

export function balanceOf(personaId: string): number {
  const s = state();
  if (!s.balances.has(personaId)) s.balances.set(personaId, STARTING_BALANCE);
  return s.balances.get(personaId)!;
}

function credit(personaId: string, amount: number): void {
  state().balances.set(personaId, balanceOf(personaId) + amount);
}

function debit(personaId: string, amount: number): void {
  const bal = balanceOf(personaId);
  if (bal < amount) throw new Error(`insufficient funds: ${personaId} has ${bal}, needs ${amount}`);
  state().balances.set(personaId, bal - amount);
}

/** Place funds in escrow. The ONLY way money leaves a balance. */
export async function hold(input: {
  kind: EscrowKind;
  fromPersona: string;
  amount: number;
  windowMs: number;
}): Promise<Escrow> {
  if (!(input.amount > 0)) throw new Error("escrow amount must be positive");
  const s = state();
  debit(input.fromPersona, input.amount);
  const escrow: Escrow = {
    id:
      "esc_" +
      createHash("sha256")
        .update(`${input.kind}:${input.fromPersona}:${marketClock.now()}:${s.seq++}`)
        .digest("hex")
        .slice(0, 14),
    kind: input.kind,
    fromPersona: input.fromPersona,
    amount: input.amount,
    createdAt: marketClock.now(),
    windowMs: input.windowMs,
    status: "held",
  };
  s.escrows.set(escrow.id, escrow);
  await persistNs("escrows");
  await persistNs("balances");
  return escrow;
}

/**
 * Resolve an escrow to its ONE terminal state. Throws on a second
 * resolution — the invariant is enforced here, not hoped for at call sites.
 *
 *   settled  → funds credit `to`
 *   refunded → funds return to the payer
 *   lottery  → funds credit `to` (the drawn winner); the state is named
 *              differently so the ledger records HOW the money moved
 */
export async function resolve(
  escrowId: string,
  terminal: EscrowTerminal,
  to?: string
): Promise<Escrow> {
  const s = state();
  const escrow = s.escrows.get(escrowId);
  if (!escrow) throw new Error(`unknown escrow ${escrowId}`);
  if (escrow.status !== "held")
    throw new Error(
      `escrow ${escrowId} already resolved to ${escrow.status} — a second resolution is a double-spend`
    );
  if (terminal === "refunded") {
    credit(escrow.fromPersona, escrow.amount);
    escrow.resolvedTo = escrow.fromPersona;
  } else {
    if (!to) throw new Error(`${terminal} requires a recipient`);
    credit(to, escrow.amount);
    escrow.resolvedTo = to;
  }
  escrow.status = terminal;
  escrow.resolvedAt = marketClock.now();
  s.escrows.set(escrowId, escrow);
  await persistNs("escrows");
  await persistNs("balances");
  return escrow;
}

/**
 * Resolve a POT: several escrows settle together, and the combined amount
 * redistributes to recipients in exact, caller-specified shares. Used by
 * tip-gated epochs, where the payout curve (quadratic on likes) has nothing
 * to do with who paid which escrow.
 *
 * Conservation is enforced HERE: recipient amounts must sum to the pot to
 * the cent, or the whole resolution throws and nothing moves. Every escrow
 * still reaches exactly one terminal state.
 */
export async function resolvePot(
  escrowIds: string[],
  recipients: { to: string; amount: number }[],
  potLabel: string
): Promise<void> {
  const s = state();
  const escrows = escrowIds.map((id) => {
    const e = s.escrows.get(id);
    if (!e) throw new Error(`unknown escrow ${id}`);
    if (e.status !== "held") throw new Error(`escrow ${id} already ${e.status}`);
    return e;
  });
  const pot = Math.round(escrows.reduce((a, e) => a + e.amount, 0) * 100) / 100;
  const out = Math.round(recipients.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  if (pot !== out)
    throw new Error(`pot resolution does not conserve: in ${pot}, out ${out} — refusing to move anything`);
  for (const e of escrows) {
    e.status = "settled";
    e.resolvedTo = potLabel;
    e.resolvedAt = marketClock.now();
    s.escrows.set(e.id, e);
  }
  for (const r of recipients) credit(r.to, r.amount);
  await persistNs("escrows");
  await persistNs("balances");
}

export function getEscrow(id: string): Escrow | null {
  return state().escrows.get(id) ?? null;
}

export function heldTotal(): number {
  let sum = 0;
  for (const e of state().escrows.values()) if (e.status === "held") sum += e.amount;
  return sum;
}

/** Conservation snapshot for the invariant test: balances + held escrow. */
export function conservationTotal(): number {
  let balances = 0;
  for (const b of state().balances.values()) balances += b;
  return balances + heldTotal();
}

export function isExpired(escrow: Escrow): boolean {
  return marketClock.now() > escrow.createdAt + escrow.windowMs;
}
