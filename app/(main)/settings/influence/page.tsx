import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { InfluenceIsland } from "@/components/settings/InfluencePane";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Influence / X" };
export const dynamic = "force-dynamic";

export default async function InfluenceSettingsPage() {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server's activeSeedPersonaId() is the rig's FIXTURE persona —
  // the pane showed the fixture's stake history as "yours". There the server passes nothing and the island takes
  // the acting persona from the browser device. On the rig it is passed as before.
  let serverPersonaId: string | null = null;
  if (!isPublicDeployment()) {
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    serverPersonaId = activeSeedPersonaId();
  }
  return (
    <>
      <SettingsHeader title="Influence" back="/settings" />
      <InfluenceIsland serverPersonaId={serverPersonaId} />
    </>
  );
}
