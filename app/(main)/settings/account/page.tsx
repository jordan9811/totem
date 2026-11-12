import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { AccountPane, type AccountInitial } from "@/components/settings/AccountPane";
import type { PersonaSummary } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Account & Personas / X" };
export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): on a public deployment the server has no identity. This page used to read the SEEDED
// viewer here — which there is the rig's fixture (its fid, its root, the owner's real handle), never the visitor —
// so the server now renders the shell only and AccountPane reads the visitor's own device in the browser. On the
// rig the read below is the page's former read, unchanged, handed to the same island.
//
// PROD-LIVE (review fix): the rig listed SEED_VIEWER.personas whole, ignoring compartment mode, while the public
// path (GET /api/personas) is scoped — so a shared screen on the rig enumerated every sibling. The list is now
// narrowed through the same chokepoint (lib/identity/chrome.ts viewScope). Every id in it is one of MY personas, so
// the leak predicate is exactly "not in the scope's visible set". Compartment OFF hands the whole list back — the
// rig's render is unchanged. An unreadable chrome record FAILS CLOSED to the acting persona alone, never the full
// list. Tiers are read only for the personas that will be shown.
async function scopedToActive(activeId: string, ids: string[]): Promise<string[]> {
  const { viewScope } = await import("@/lib/identity/chrome");
  let visible: Set<string>;
  try {
    visible = new Set((await viewScope(activeId, ids)).visiblePersonaIds);
  } catch {
    visible = new Set([activeId]);
  }
  return ids.filter((id) => visible.has(id));
}

async function rigAccount(): Promise<AccountInitial> {
  const { SEED_VIEWER } = await import("@/lib/adapters/mock/store");
  const { mockPersonaAdapter } = await import("@/lib/adapters/mock/persona");
  const { adapters } = await import("@/lib/adapters/registry");
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const activeId = activeSeedPersonaId();
  let personas: PersonaSummary[] = [];
  const tiers: Record<string, number> = {};
  let error: string | null = null;

  try {
    const ids = await scopedToActive(activeId, SEED_VIEWER.personas);
    personas = (await Promise.all(ids.map((id) => mockPersonaAdapter.get(id)))).filter(
      Boolean
    ) as PersonaSummary[];
    for (const p of personas) {
      try {
        tiers[p.id] = await adapters.rep.tierFor(p.id);
      } catch {
        // tier unavailable — badge simply doesn't render for that persona
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }
  // LAYERS_WORLD=empty (lib/world.ts): SEED_VIEWER.personas above IS the keystore's real personas there. The root rows
  // are the real ones too: the acting persona's own Farcaster account if it has one (never the seed self's borrowed
  // fid), and where the root lives — never a fixture root id.
  const { isEmptyWorld } = await import("@/lib/world");
  if (isEmptyWorld()) {
    let fid = "none yet";
    try {
      const { personaFidRecord } = await import("@/lib/fc/personaFid");
      const rec = activeId ? await personaFidRecord(activeId) : null;
      if (rec) fid = String(rec.fid) + (rec.fname ? " (@" + rec.fname + ")" : "") + (rec.mode === "live" ? "" : " — fixture");
    } catch {
      fid = "unreadable";
    }
    return { personas, tiers, activeId, error, rootRows: { fid, root: "held by this device's keystore" }, emptyWorld: true };
  }
  return { personas, tiers, activeId, error, rootRows: { fid: String(SEED_VIEWER.fid), root: SEED_VIEWER.rootId } };
}

export default async function AccountSettings() {
  const initial = isPublicDeployment() ? null : await rigAccount();
  return (
    <>
      <SettingsHeader title="Account & Personas" back="/settings" />
      <AccountPane initial={initial} />
    </>
  );
}
