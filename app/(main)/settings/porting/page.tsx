import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { PortingPane, type PortingInitial } from "@/components/settings/PortingPane";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Relationship porting / X" };
export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): this page 500'd on a public deployment — ownPersonaIds() reads the keystore, which that
// server does not have, and activeSeedPersonaId() there is the rig's fixture persona, not the visitor. On a public
// deployment the server renders the header only and PortingPane reads the roster from the browser device. On the
// rig the roster is built here exactly as before and handed to the same island.
//
// PROD-LIVE (review fix): the rig's roster ignored compartment mode — every sibling listed on a shared screen —
// while the public route it mirrors (/api/personas/act-as-options) is scoped. It is now narrowed through the same
// chokepoint (lib/identity/chrome.ts viewScope). Every id here is one of MY personas, so the leak predicate is
// exactly "not in the scope's visible set". With compartment OFF the scope hands the whole list back, so the rig's
// render is unchanged; if the chrome record cannot be read the scope FAILS CLOSED to the acting persona alone —
// never to the full list (a compartment that evaporates on a validator hiccup is not a compartment).
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

async function rigRoster(): Promise<PortingInitial> {
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const { SEED_VIEWER, personaById } = await import("@/lib/adapters/mock/store");
  const { getPersona: keystorePersona, ownPersonaIds } = await import("@/lib/identity/keystore");
  const { kindOf } = await import("@/lib/identity/personaKind");
  const activeId = activeSeedPersonaId();
  const ids = await scopedToActive(activeId, [...new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])]);
  const personas = ids.map((id) => ({
    id,
    handle: personaById.get(id)?.handle ?? keystorePersona(id)?.handle ?? id,
    kind: (kindOf(id) === "private" ? "private" : "public") as "public" | "private",
  }));
  return { personaId: activeId, personas };
}

export default async function PortingSettingsPage() {
  const initial = isPublicDeployment() ? null : await rigRoster();
  return (
    <>
      <SettingsHeader title="Relationship porting" back="/settings" />
      <PortingPane initial={initial} />
    </>
  );
}
