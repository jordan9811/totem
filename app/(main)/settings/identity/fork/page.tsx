import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ForkWizardIsland } from "@/components/settings/ForkWizard";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Fork this persona / X" };
export const dynamic = "force-dynamic";

export default async function ForkSettings() {
  // The wizard always operates on the persona you are currently acting as.
  // Forking someone else's persona is not a thing that exists.
  //
  // PROD-LIVE (D-CU-0-4): on a public deployment the server's activeSeedPersonaId() is the rig's FIXTURE persona,
  // never the visitor — handing it over made the wizard fork the fixture (403 not_own). There the server passes
  // nothing and the island takes the acting persona from the browser device. On the rig it is passed as before.
  let serverPersonaId: string | null = null;
  if (!isPublicDeployment()) {
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    serverPersonaId = activeSeedPersonaId();
  }
  return (
    <>
      <SettingsHeader title="Fork this persona" back="/settings" />
      <ForkWizardIsland serverPersonaId={serverPersonaId} />
    </>
  );
}
