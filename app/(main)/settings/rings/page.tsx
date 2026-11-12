import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { RingsPane } from "@/components/settings/RingsPane";

// PERSONA LAUNCH P4 — Settings › Rings. A shell: the pane reads /api/rings, which the device answers (the visitor's
// browser device on a public deployment; the rig and the owner service answer it themselves). Nothing is read here.
export const metadata: Metadata = { title: "Rings / X" };
export const dynamic = "force-dynamic";

export default function RingsSettingsPage() {
  return (
    <>
      <SettingsHeader title="Rings" back="/settings" />
      <RingsPane />
    </>
  );
}
