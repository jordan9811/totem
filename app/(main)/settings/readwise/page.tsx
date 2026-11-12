import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ReadwisePane } from "@/components/settings/ReadwisePane";

export const metadata: Metadata = { title: "Readwise / X" };
export const dynamic = "force-dynamic";

export default function ReadwiseSettings() {
  return (
    <>
      <SettingsHeader title="Readwise" back="/settings" />
      <ReadwisePane />
    </>
  );
}
