import "server-only";
// MEGA PASS 2 Gate 1 — SEEDED STAKE HISTORY (fixture only).
//
// Seeds through the PRODUCT path: every row is signed by its fixture
// persona's own key and posted to the validator's `/stakes` exactly as a
// real client would — there is no seed-only door. Deterministic nonces
// make the ids stable, so re-seeding is a no-op (the validator ignores a
// duplicate id) and a seed reset reproduces the same history.
//
// What it seeds, and why:
//   • ONE OBVIOUSLY-COORDINATED CLUSTER: three personas staking `good` on
//     the same three casts in the same epoch/hour — the thing a lens must
//     be able to SEE (legibility, not enforcement). Gate 2's dwell-heavy
//     lens re-computes their accrual downward.
//   • DELAYED-EVALUATION OUTCOMES across TWO epochs: honest stakes whose
//     confirmation the canonical signals decide — a `wrong` on a cast
//     that carries a qualifying note (confirmed), a `good` on a clean
//     cast (confirmed), a `good` on a noted cast (not confirmed).
// Nothing here touches note_5 (0xhi0066, one endorsement): stake-backed
// endorsements would flip it to qualifying for every viewer, and older
// suites assert the seeded baseline.
import { validatorUrl } from "@/lib/ports";
import { zkMode } from "@/lib/zk/config";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { fixturePublicKey, fixtureSignAs } from "@/lib/identity/fixtureRoots";
import { stakeCanonical, type StakeAction, type StakeBody, type StakeDirection } from "./types";

interface SeedStake {
  personaId: string;
  castHash: string;
  action: StakeAction;
  direction: StakeDirection;
  amount: number;
  /** epochs BEFORE the current one (1 = the previous epoch) */
  back: number;
}

export const CLUSTER_MEMBERS = ["persona_acc_crypto_4", "persona_acc_crypto_5", "persona_acc_crypto_6"] as const;
export const CLUSTER_CASTS = ["0xcr0001", "0xcr0036", "0xcr0118"] as const;

const SEED: SeedStake[] = [
  // the coordinated cluster — previous epoch, same direction, same amount, same casts
  ...CLUSTER_MEMBERS.flatMap((personaId) => CLUSTER_CASTS.map((castHash) => ({ personaId, castHash, action: "recast" as const, direction: "good" as const, amount: 5, back: 1 }))),
  // honest stakes, two epochs of outcomes
  { personaId: "persona_acc_fantasy_1", castHash: "0xfa0016", action: "refute", direction: "wrong", amount: 4, back: 2 }, // note_2 stands → confirmed
  { personaId: "persona_acc_astro_2", castHash: "0xas0377", action: "like", direction: "good", amount: 3, back: 2 }, // clean cast → confirmed
  { personaId: "persona_acc_hist_1", castHash: "0xcr0036", action: "like", direction: "good", amount: 3, back: 1 }, // note_1 stands → not confirmed
  { personaId: "persona_acc_food_1", castHash: "0xfa0016", action: "note", direction: "note-worthy", amount: 2, back: 1 }, // already-qualifying note → confirmed
  { personaId: "persona_acc_astro_3", castHash: "0xas0021", action: "curate", direction: "worth-reading", amount: 2, back: 2 }, // note_3 stands → not confirmed
];

let seededForEpoch: number | null = null;

/** idempotent; fixture only; best-effort (a validator that is down seeds nothing and says so in the return) */
export async function seedStakes(): Promise<{ seeded: number; skipped: number; epoch: number } | null> {
  if (zkMode() !== "fixture") return null;
  let epoch: number;
  try {
    epoch = (await fetchEpoch("fixture")).epoch;
  } catch {
    return null;
  }
  if (seededForEpoch === epoch) return { seeded: 0, skipped: SEED.length, epoch };
  let seeded = 0;
  let skipped = 0;
  for (const [i, s] of SEED.entries()) {
    const targetEpoch = Math.max(0, epoch - s.back);
    const body: StakeBody = { mode: "fixture", personaId: s.personaId, castHash: s.castHash, action: s.action, direction: s.direction, amount: s.amount, epoch: targetEpoch, nonce: ("seed" + i).padEnd(16, "0") };
    const pubkey = fixturePublicKey(s.personaId);
    const signature = fixtureSignAs(s.personaId, stakeCanonical(body));
    if (!pubkey || !signature) { skipped++; continue; }
    try {
      const res = await fetch(`${validatorUrl()}/stakes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pubkey, signature }), cache: "no-store" });
      if (res.ok) seeded++; else skipped++;
    } catch {
      skipped++;
    }
  }
  seededForEpoch = epoch;
  return { seeded, skipped, epoch };
}

export function resetStakeSeedMarker(): void {
  seededForEpoch = null;
}
