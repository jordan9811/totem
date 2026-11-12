// BROWSER KEYSTORE PASS Gate 1 stage 3 — `@/lib/session` for the device bundle. The server's session resolves a
// root from an opaque cookie handle and falls back to the SEEDED self (fid 9152) — a rig identity. In the browser
// the session is the device's own: its root, the personas its keystore holds (registered into the store at boot),
// and whichever of them the device's persona cookie names.
import { SEED_VIEWER, personaByHandle, personaById } from "@/lib/adapters/mock/store";
import { activeSeedPersonaId } from "@/lib/activePersona";
import type { Persona } from "@/lib/types";
import type { KeystorePersona } from "@/lib/identity/keystore";

export const ROOT_COOKIE = "layers_root";
export const PERSONA_COOKIE = "layers_active_persona";

/**
 * BROWSER KEYSTORE PASS Gate 6 — the roster is the KEYSTORE's, read every time, not the snapshot boot took.
 *
 * A persona minted after boot (a fork, the composer's "new persona") lands in the keystore and in the store's
 * rendering map, but the device viewer's id list was written once at boot — so on a deployed preview a fork
 * answered 200 and then appeared nowhere, which is what `npm run smoke:deployed` caught. Adopting the keystore's
 * list here costs a local read and keeps every surface that asks "which personas are mine" honest.
 */
async function adoptKeystorePersonas(): Promise<void> {
  let held: KeystorePersona[];
  try {
    const ks = await import("@/lib/identity/keystore");
    held = ks.listPersonas();
  } catch {
    return; // no keystore on this path: the snapshot is all there is
  }
  const known = new Set(SEED_VIEWER.personas);
  for (const p of held) {
    if (!personaById.has(p.id)) {
      // registered exactly as lib/device/boot.ts registers the personas it minted at boot
      personaById.set(p.id, {
        id: p.id,
        rootId: SEED_VIEWER.rootId,
        name: p.name,
        handle: p.handle,
        avatarUrl: p.avatarUrl ?? "",
        bio: p.bio ?? "",
        cluster: p.cluster ?? "",
        tier: 1,
        demoTags: ["device"],
        // PERSONA LAUNCH P1 (SIWF): the read-only public self says so on its store entry, so /api/personas and the
        // switcher can render it as "Farcaster · read-only" and never as a switch target
        ...(p.publicSelf === true ? { publicSelf: true } : {}),
      } as unknown as NonNullable<ReturnType<typeof personaById.get>>);
      personaByHandle.set(p.handle, personaById.get(p.id)!);
    }
    if (!known.has(p.id)) {
      known.add(p.id);
      SEED_VIEWER.personas.push(p.id);
    }
  }
}

export interface Session {
  /** DEVICE-INTERNAL ONLY. Never serialize this into a response — the root-leak test greps for it. */
  rootId: string | null;
  personas: Persona[];
  active: Persona | null;
}

export async function getSession(): Promise<Session> {
  await adoptKeystorePersonas();
  const personas = SEED_VIEWER.personas.map((id) => personaById.get(id)).filter(Boolean) as unknown as Persona[];
  const activeId = activeSeedPersonaId();
  // ACTING AS YOURSELF (lib/device/actingRoot.ts): on the live site an acting id of "" is "no persona acts" (no public
  // self either), never "the first persona"; activeSeedPersonaId already answers the public self when there is one
  const { liveDevice } = await import("@/lib/device/actingRoot");
  const active = personas.find((p) => p.id === activeId) ?? (liveDevice() ? null : personas[0] ?? null);
  return { rootId: SEED_VIEWER.rootId || null, personas, active };
}
