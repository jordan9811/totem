"use client";
// NOTIFICATIONS FROM FARCASTER — which notifications the page shows. On the live site, a visitor signed in with
// Farcaster who acts as themselves (no persona acting) sees their REAL Farcaster notifications, read by this tab from a
// Farcaster node (components/hub/HubNotifications.tsx). Everyone else, and that same visitor the moment a persona acts,
// sees exactly what the page showed before (components/notifications/NotificationsIsland.tsx: the acting persona's
// world, with its mode's policy), and nothing is read from the node as the root (the device refuses those reads too).
// The roster is waited for first: never a guess either way.
import type { NotificationsView } from "@/lib/views/social";
import { TimelineSkeleton } from "@/components/Skeletons";
import { HubNotifications } from "@/components/hub/HubNotifications";
import { useRootReads } from "@/components/hub/rootActs";
import { NotificationsIsland } from "./NotificationsIsland";

export function NotificationsBody({ tab, initial }: { tab: string; initial: NotificationsView | null }) {
  const who = useRootReads(initial === null);
  if (who === "loading") {
    return (
      <div data-testid="notifications-loading" aria-busy="true">
        <TimelineSkeleton count={4} />
      </div>
    );
  }
  if (who === "root") return <HubNotifications tab={tab} />;
  return <NotificationsIsland tab={tab} initial={initial} />;
}
