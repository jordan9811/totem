import "server-only";
// Seeds the grant graph for the fixture multi-persona accounts.
//
// Why this matters beyond demo data: under v3 block fan-out only reaches
// siblings the viewer can RESOLVE. The legacy suite asserts that blocking one
// persona of a multi-persona account hides all of them — that assertion is
// now only true because those accounts publish a public-tier grant. The
// behaviour is unchanged; what changed is that it is now *justified* by a
// disclosure fact rather than by the server knowing everything.
//
// All four tiers are represented so every tier is demoable on existing
// accounts (mega-pass Gate 1 seeding requirement).
import { OPEN_AUDIENCE, signGrantWith, type Grant, type GrantTier } from "./grants";
import { signForPersona } from "./keys";
import { SEED_PERSONAS, state } from "@/lib/adapters/mock/store";

/** Which fixture pair gets which tier. Keyed by handle for readability. */
const TIER_PLAN: { a: string; b: string; tier: GrantTier; audience?: string[] }[] = [
  // Public: the doxxed analyst whose alt posts astronomy. Everyone can see it.
  { a: "basisrisk", b: "duskorbiter", tier: "public" },
  // Opt-in: link exists, resolves only on request, and the asking is logged.
  { a: "startsitsam", b: "deephistorydan", tier: "opt_in" },
  // Whitelist: only named accounts can resolve it.
  {
    a: "brothandbones",
    b: "linescoreluke",
    tier: "whitelist",
    audience: ["yeak__", "crustcritic"],
  },
  // Hidden is the absence of any row — deliberately not listed here. The
  // Gate 1 test asserts no grant exists for the hidden pair.
];

export const HIDDEN_PAIR = { a: "aperture_annie", b: "collimationking" };

/**
 * THE BETRAYAL SCENARIO — the fork demo, one click deep.
 *
 * @brothandbones runs an anonymous sports alt (@linescoreluke) and whitelisted
 * exactly two people. One of them started repeating things only a whitelist
 * holder could know. There is no undo for that; there is only moving.
 *
 * The wizard reads this to pre-uncheck the suspect. It is demo staging, not a
 * security mechanism: nothing here decides who CAN resolve anything — the
 * grants do that. It only decides which box starts ticked, so the operator
 * does not have to know the backstory to run the demo.
 */
export const BETRAYAL = {
  persona: "brothandbones",
  suspect: "crustcritic",
  keeper: "yeak__",
  note: "Repeated a detail from a whitelist-only post, in public, twice.",
};

/** Is this audience member the seeded suspect for this persona? */
export function isSuspect(personaId: string, audienceMember: string): boolean {
  return (
    idFor(BETRAYAL.persona) === personaId && idFor(BETRAYAL.suspect) === audienceMember
  );
}

function idFor(handle: string): string | null {
  return SEED_PERSONAS.find((p) => p.handle === handle)?.id ?? null;
}

function put(g: Omit<Grant, "id" | "signature">) {
  // Issuer is fromPersona; every fromPersona here is seeded, so fixture keys
  // resolve. A refusal is a broken seed universe, not a state — throw loud.
  const signed = signGrantWith(g, (c) => signForPersona(g.fromPersona, c));
  if (!signed) {
    throw new Error(`seedGrantGraph: no signing key for seeded persona ${g.fromPersona}`);
  }
  state().grantsV3.set(signed.id, { ...g, id: signed.id, signature: signed.signature });
}

/** Idempotent: safe to call on every boot and after a seed reset. */
export function seedGrantGraph(): { issued: number; tiers: Record<string, number> } {
  const s = state();
  const tiers: Record<string, number> = {};
  let issued = 0;

  for (const plan of TIER_PLAN) {
    const from = idFor(plan.a);
    const to = idFor(plan.b);
    if (!from || !to) continue;

    const audiences =
      plan.tier === "whitelist"
        ? (plan.audience ?? []).map(idFor).filter(Boolean as unknown as (v: string | null) => v is string)
        : [OPEN_AUDIENCE];

    for (const audienceMember of audiences) {
      const already = [...s.grantsV3.values()].some(
        (g) =>
          g.fromPersona === from &&
          g.toPersona === to &&
          g.audienceMember === audienceMember &&
          g.revokedAt === null
      );
      if (already) continue;
      put({
        fromPersona: from,
        toPersona: to,
        audienceMember,
        tier: plan.tier,
        issuedAt: Date.now(),
        revokedAt: null,
      });
      issued++;
      tiers[plan.tier] = (tiers[plan.tier] ?? 0) + 1;
    }
  }
  return { issued, tiers };
}

/** Every fixture pair the demo cares about, with the tier each represents. */
export function seededPairs() {
  return [
    ...TIER_PLAN.map((p) => ({ ...p, hidden: false })),
    { ...HIDDEN_PAIR, tier: "hidden" as const, hidden: true },
  ];
}
