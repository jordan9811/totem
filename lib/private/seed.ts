import "server-only";
// The seeded private persona: the private account inside a normal account.
//
// @backyard_scope is the viewer's own second persona. Making IT private, and
// not some new fixture, is the point of the feature — this is not a separate
// app or a separate login, it is one more persona under the same root, with
// an audience instead of a public.
import { signGrantWith, type Grant } from "@/lib/identity/grants";
import { signForPersona } from "@/lib/identity/keys";
import { SEED_PERSONAS, state, personaById } from "@/lib/adapters/mock/store";

/** The seeded private persona, by handle. */
export const PRIVATE_PERSONA_HANDLE = "backyard_scope";

/** Close friends who can see it. Everyone else gets nothing, silently. */
export const PRIVATE_AUDIENCE_HANDLES = ["aperture_annie", "messierhunter_"];

/** Posts only the audience ever sees. Distinct wording so tests can grep. */
const SEEDED_PRIVATE_POSTS = [
  "clouded out again. four nights running. the scope is basically furniture at this point",
  "took the 8in out to the field behind the water tower. bortle 4 maybe. andromeda naked eye for about a second before my eyes watered",
  "honestly half the reason i keep this account separate is so i can post six times about a smudge",
];

function idFor(handle: string): string | null {
  return SEED_PERSONAS.find((p) => p.handle === handle)?.id ?? null;
}

/** Persona ids that are private, derived from the seed rather than guessed. */
export function seededPrivatePersonaIds(): string[] {
  const id = idFor(PRIVATE_PERSONA_HANDLE);
  return id ? [id] : [];
}

function put(g: Omit<Grant, "id" | "signature">) {
  // Issuer is fromPersona — for audience grants that IS the private persona
  // (from === to), which is right: it signs its own audience. Seeded personas
  // always have fixture keys, so a refusal is a bug — throw loud.
  const signed = signGrantWith(g, (c) => signForPersona(g.fromPersona, c));
  if (!signed) {
    throw new Error(`seedPrivateWorld: no signing key for seeded persona ${g.fromPersona}`);
  }
  state().grantsV3.set(signed.id, { ...g, id: signed.id, signature: signed.signature });
}

/** Idempotent: safe on every boot and after a seed reset. */
export function seedPrivateWorld(): { audience: number; posts: number } {
  const persona = idFor(PRIVATE_PERSONA_HANDLE);
  if (!persona) return { audience: 0, posts: 0 };
  const s = state();

  let audience = 0;
  for (const handle of PRIVATE_AUDIENCE_HANDLES) {
    const member = idFor(handle);
    if (!member) continue;
    const already = [...s.grantsV3.values()].some(
      (g) =>
        g.kind === "audience" &&
        g.fromPersona === persona &&
        g.audienceMember === member &&
        g.revokedAt === null
    );
    if (already) continue;
    put({
      fromPersona: persona,
      // An audience grant is about one persona and one viewer, not a pair.
      toPersona: persona,
      audienceMember: member,
      tier: "whitelist",
      kind: "audience",
      issuedAt: Date.now(),
      revokedAt: null,
    });
    audience++;
  }

  let posts = 0;
  // Hashes are fixed strings, so a reset reproduces the same fixture rather
  // than accreting new posts. Timestamps are RELATIVE to now, because the
  // timeline interleaves by recency: a fixed past date sank these below every
  // seeded post and the feature became invisible in the product and in the
  // demo, while still passing its data-level tests.
  const MINUTES_AGO = [3, 38, 90];
  SEEDED_PRIVATE_POSTS.forEach((text, i) => {
    const hash = `0xpriv_seed_${i}`;
    if (s.privatePosts.has(hash)) return;
    s.privatePosts.set(hash, {
      hash,
      authorPersonaId: persona,
      text,
      createdAt: Date.now() - (MINUTES_AGO[i] ?? 60) * 60_000,
      replyToHash: null,
      likes: [],
      bookmarkedBy: [],
    });
    posts++;
  });

  // The private persona must be renderable — every surface reads personaById.
  if (!personaById.has(persona)) {
    const seeded = SEED_PERSONAS.find((p) => p.id === persona);
    if (seeded) personaById.set(persona, seeded);
  }

  return { audience, posts };
}
