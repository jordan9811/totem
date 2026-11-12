import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ScrollZonesPane } from "@/components/settings/ScrollZonesPane";

export const metadata: Metadata = { title: "Scroll zones / X" };
export const dynamic = "force-dynamic";

export default function ScrollZonesSettingsPage() {
  return (
    <>
      <SettingsHeader title="Scroll zones" back="/settings" />
      <ScrollZonesPane />
    </>
  );
}
