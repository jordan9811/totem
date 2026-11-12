import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { AnonModerationPane } from "@/components/settings/AnonModerationPane";

export const metadata: Metadata = { title: "Moderation / X" };
export const dynamic = "force-dynamic";

// PUBLIC GO-LIVE (the relay track) — Settings › Moderation: the public @anon's takedown queue. Renders for every visitor
// ("You are not a moderator on this site" when that is true); a moderator's device reads the reported posts (signed) and
// removes or keeps each one (signed). The pane is a client island: the device answers /api/anon/moderation in the tab.
export default function ModerationSettingsPage() {
  return (
    <>
      <SettingsHeader title="Moderation" back="/settings" />
      <AnonModerationPane />
    </>
  );
}
