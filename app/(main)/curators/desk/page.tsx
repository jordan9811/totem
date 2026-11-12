import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { DeskPanel } from "@/components/curators/DeskPanel";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaById } from "@/lib/adapters/mock/store";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Curator desk / X" };
export const dynamic = "force-dynamic";

export default function DeskPage() {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server's acting persona is the fixture persona (the owner's
  // handle), not the visitor — so it names no one, and DeskPanel names the device's acting persona instead.
  // On the rig: the seeded acting persona's handle, as always.
  const handle = isPublicDeployment() ? null : personaById.get(activeSeedPersonaId())?.handle ?? "you";
  return (
    <>
      <PageHeader back title="Curator desk" subtitle="Draft, co-sign, issue — thresholds are the publish button" />
      <DeskPanel activeHandle={handle} />
    </>
  );
}
