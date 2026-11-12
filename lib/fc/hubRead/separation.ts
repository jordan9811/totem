// FOLLOWING FROM THE HUB — PERSONA SEPARATION (2026-11-05 review; SECURITY-POSTURE.md §36 A-HUBREAD-PERSONA-SEPARATION).
// The device's two answers lib/fc/hubRead/read.ts asks before any read of a Farcaster node: which accounts are this
// visitor's own personas (never named in a read: the node already ties this browser to the root), and whether a persona
// is acting (then nothing is read as the root). Kept apart from read.ts so the unit harness can stand in for the vault
// and the jar; read.ts maps every throw here to a refusal (fail closed).

/** the persona accounts (and the shared anon account when this app knows it) this vault holds, with their fnames.
 *  THROWS when the vault's records cannot be read: the caller reads nothing. */
export async function ownPersonaAccounts(): Promise<{ fids: Set<number>; names: Map<number, string | null> }> {
  const m = await import("@/lib/fc/personaFid");
  const recs = await m.allPersonaFids();
  let anon: number | null = null;
  try {
    anon = await m.anonAccountFid();
  } catch {
    /* not known here yet: the anon account is one shared account every visitor reads (/anon), so a read of it names
       no one; left out of the set rather than refusing every read */
  }
  const fids = m.ownAccountFids(recs, anon);
  const names = new Map<number, string | null>();
  for (const r of recs) if (fids.has(r.fid)) names.set(r.fid, r.fname);
  return { fids, names };
}

/** a persona is this tab's acting identity. The device's jar only ever names a persona that can post (boot and the
 *  switcher never name the read-only root), so any name there counts: a stale one hides the root's reads (fail closed),
 *  never the other way round. THROWS when the jar cannot be read: the caller treats that as acting. */
export async function personaActing(): Promise<boolean> {
  const { deviceJar } = await import("@/lib/device/jar");
  const { SEED_PERSONA_COOKIE } = await import("@/lib/activePersona");
  return !!deviceJar.get(SEED_PERSONA_COOKIE);
}

/** SPEC C: the ROOT is this tab's acting identity — the live site's browser device with no persona named
 *  (lib/device/actingRoot.ts noPersonaActs). Off the live site a persona always acts (there is no acting as yourself
 *  there), so this is false. THROWS when the jar cannot be read: the caller treats that as a persona acting. */
export async function rootActs(): Promise<boolean> {
  const { noPersonaActs } = await import("@/lib/device/actingRoot");
  return noPersonaActs();
}
