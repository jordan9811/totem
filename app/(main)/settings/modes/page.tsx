import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ModeBuilder } from "@/components/settings/ModeBuilder";

export const metadata: Metadata = { title: "Modes / X" };
export const dynamic = "force-dynamic";

export default function ModesSettings() {
  return (
    <>
      <SettingsHeader title="Modes" back="/settings" />
      <ModeBuilder />
    </>
  );
}
