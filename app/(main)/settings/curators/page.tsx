import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { CuratorPane } from "@/components/settings/CuratorPane";

export const metadata: Metadata = { title: "Curators / X" };
export const dynamic = "force-dynamic";

export default function CuratorSettings() {
  return (
    <>
      <SettingsHeader title="Curator subscriptions" back="/settings" />
      <CuratorPane />
    </>
  );
}
