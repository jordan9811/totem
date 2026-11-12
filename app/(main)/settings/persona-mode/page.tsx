import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { PersonaModeMatrix } from "@/components/settings/PersonaModeMatrix";
import { PersonaTintPane } from "@/components/settings/PersonaTintPane";

export const metadata: Metadata = { title: "Persona & mode bindings / X" };
export const dynamic = "force-dynamic";

export default function PersonaModeSettings() {
  return (
    <>
      <SettingsHeader title="Persona & mode bindings" back="/settings" />
      <PersonaModeMatrix />
      <PersonaTintPane />
    </>
  );
}
