import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { FeedHealthPane } from "@/components/settings/FeedHealthPane";

export const metadata: Metadata = { title: "Feed Health / X" };
export const dynamic = "force-dynamic";

export default function FeedHealthSettings() {
  return (
    <>
      <SettingsHeader title="Feed Health" back="/settings" />
      <FeedHealthPane />
    </>
  );
}
