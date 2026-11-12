import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { DmInbox } from "@/components/market/DmInbox";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Messages / X" };
export const dynamic = "force-dynamic";

export default function MessagesPage() {
  // PROD-LIVE (D-CU-0-4): never hand a client pane the server's persona on a public deployment — there it is the
  // fixture persona (the owner's), not the visitor. DmInbox takes the device's acting persona from the chrome instead.
  // On the rig: the seeded acting persona, as always.
  const personaId = isPublicDeployment() ? undefined : activeSeedPersonaId();
  return (
    <>
      <PageHeader back title="Messages" subtitle="Pay-to-DM — spam pays you" />
      <DmInbox personaId={personaId} />
    </>
  );
}
