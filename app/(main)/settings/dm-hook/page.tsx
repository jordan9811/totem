import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { DmHookPanel } from "@/components/settings/DmHookPanel";

export const metadata: Metadata = { title: "DM to bookmark / X" };
export const dynamic = "force-dynamic";

export default function DmHookSettingsPage() {
  return (
    <>
      <SettingsHeader title="DM to bookmark" back="/settings" />
      <DmHookPanel />
    </>
  );
}
