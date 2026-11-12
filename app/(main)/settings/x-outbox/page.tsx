import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { XOutboxPanel } from "@/components/settings/XOutboxPanel";

export const metadata: Metadata = { title: "Totem on X / X" };
export const dynamic = "force-dynamic";

// PERSONA LAUNCH P8 — Settings › Totem on X: anonymous posts (test data). The outbox's queue counts, this device's copies
// and where each one is, and — for the moderator only — the posts waiting for a decision. Test data everywhere: no X call
// leaves the fixture transport.
export default function XOutboxSettingsPage() {
  return (
    <>
      <SettingsHeader title="Totem on X" back="/settings" />
      <XOutboxPanel />
    </>
  );
}
