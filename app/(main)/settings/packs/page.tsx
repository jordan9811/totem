import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { PackBuilder } from "@/components/settings/PackBuilder";

export const metadata: Metadata = { title: "Filter packs / X" };
export const dynamic = "force-dynamic";

export default function PackSettings() {
  return (
    <>
      <SettingsHeader title="Filter packs" back="/settings" />
      <PackBuilder />
    </>
  );
}
