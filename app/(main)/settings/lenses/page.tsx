import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { LensPane } from "@/components/settings/LensPane";

export const metadata: Metadata = { title: "Lenses / X" };
export const dynamic = "force-dynamic";

export default function LensesSettingsPage() {
  return (
    <>
      <SettingsHeader title="Lenses" back="/settings" />
      <LensPane />
    </>
  );
}
