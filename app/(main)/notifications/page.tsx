import type { Metadata } from "next";
import Link from "next/link";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { notificationsView } from "@/lib/views/social.server";
import { NotificationsBody } from "@/components/notifications/NotificationsBody";
import { SettingsGear } from "@/components/icons";
import { NoPersonaYet } from "@/components/world/NoPersonaYet";

export const metadata: Metadata = { title: "Notifications / X" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  // PROD-LIVE (review fix): `|| "all"`, not `?? "all"` — the SAME normalisation /api/notifications applies. `??` kept
  // an empty `?tab=` as "", the route answered for "all", and the island (which checks the answer's tab against its
  // own) waited forever for an answer about "" on a public deployment. Now all three sides agree on "all".
  const active = searchParams.tab || "all";
  // PROD-LIVE (D-CU-0-4): the list is filtered by the ACTIVE mode's notificationPolicy — the acting persona's mode,
  // which a public deployment's server does not hold (the mode read reached for a device key and was swallowed into
  // "all"). There the server renders the header and tabs; the island fetches /api/notifications and the browser
  // device answers it. On the rig the list is computed exactly as before and handed to the same island.
  const initial = isPublicDeployment() ? null : await notificationsView(active);
  const tabs = [
    { id: "all", label: "All" },
    { id: "priority", label: "Priority" },
    { id: "mentions", label: "Mentions" },
  ];
  return (
    <>
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md">
        <div className="flex h-[53px] items-center justify-between px-4">
          <h1 className="text-xl font-black leading-6">Notifications</h1>
          {/* PROD-LIVE: the gear was a button with no handler. It goes where the notification policy is actually
              set — the modes screen — as a client-side navigation (a document load would wipe an unsaved identity). */}
          <Link
            href="/settings/modes"
            aria-label="Settings"
            data-testid="notifications-settings"
            className="-mr-2 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover"
          >
            <SettingsGear size={20} />
          </Link>
        </div>
        <div className="flex border-b border-x-border">
          {tabs.map((tab) => (
            // PROD-LIVE: next/link, not <a> — a plain anchor is a full document load, which on a public deployment
            // mints the visitor a brand-new identity.
            <Link
              key={tab.id}
              href={tab.id === "all" ? "/notifications" : `/notifications?tab=${tab.id}`}
              className="flex h-[53px] flex-1 items-center justify-center px-4 transition-colors hover:bg-x-hover"
            >
              <span
                className={`relative flex h-full items-center text-[15px] ${
                  active === tab.id ? "font-bold text-x-text" : "font-medium text-x-sec"
                }`}
              >
                {tab.label}
                {active === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-1 rounded-full bg-x-blue" />
                )}
              </span>
            </Link>
          ))}
        </div>
      </div>
      {/* LAYERS_WORLD=empty (review F6): no persona yet is said, with the road to the create form.
          NOTIFICATIONS FROM FARCASTER: on the live site, a visitor acting as their own Farcaster account sees their real
          Farcaster notifications, read by the tab from a node; a persona acting sees the persona's, as before. */}
      {initial?.noPersona ? <NoPersonaYet what="Notifications" /> : <NotificationsBody tab={active} initial={initial} />}
    </>
  );
}
