import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { RuleBuilder } from "@/components/settings/RuleBuilder";

export const metadata: Metadata = { title: "Rules & Filters / X" };
export const dynamic = "force-dynamic";

export default function RulesSettings() {
  return (
    <>
      <SettingsHeader title="Rules & Filters" back="/settings" />
      <RuleBuilder />
    </>
  );
}
