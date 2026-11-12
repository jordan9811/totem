import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { AttestationPane } from "@/components/settings/AttestationPane";
import { LinkedAccounts } from "@/components/settings/LinkedAccounts";

export const metadata: Metadata = { title: "Attestations / X" };
export const dynamic = "force-dynamic";

export default function AttestationsSettings() {
  return (
    <>
      <SettingsHeader title="Attestations" back="/settings" />
      <AttestationPane />
      <LinkedAccounts />
    </>
  );
}
