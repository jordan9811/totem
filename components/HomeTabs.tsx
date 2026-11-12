"use client";
import Link from "next/link";
import { ChevronDown, PlusIcon } from "./icons";
import { useApp } from "./Providers";

export function HomeTabs({
  active,
  channels,
  right,
}: {
  active: string;
  channels: { id: string; name: string }[];
  right?: React.ReactNode;
}) {
  // FC-READ (no channels) — OWNER DECISION D-FCREAD-NO-CHANNELS-IN-V1: on a PUBLIC deployment (the device is the page)
  // the bar carries no channel tabs, whatever it is handed (app/(main)/home/page.tsx already hands none there, and
  // treats every tab but Following as For You). The rig renders its channel tabs exactly as before.
  const { deviceIsThePage } = useApp();
  const tabs = [
    { id: "foryou", label: "For you", chevron: true },
    { id: "following", label: "Following" },
    ...(deviceIsThePage ? [] : channels).map((c) => ({ id: c.id, label: c.name })),
  ];
  return (
    <div data-chrome="header" className="persona-chrome persona-mode-edge sticky top-0 z-20 border-b border-x-border bg-white/85 backdrop-blur-md">
      {/* Tabs scroll horizontally; the mode control is pinned outside that
          scroll area so it stays visible at every width.

          PROD-LIVE (mobile, rig and public alike): at 360-430 px the tabs and the (persona, mode) control shared one
          53 px row, and the tabs LOST — each tab was `flex-1 min-w-0`, so it shrank below its own label and the
          labels painted over one another ("r yolu Follo"), while the control (the @handle, the swipe arrows and the
          mode pill) kept its full width. Now a tab never shrinks below its label (min-w-fit: the row scrolls, as the
          note above always meant it to), and below `sm` the control takes its OWN row under the tabs instead of
          squeezing them; from `sm` up it is pinned at the right of the tab row, as before. Same elements, same
          testids, at every width — only the layout moves. */}
      <div className="flex flex-col sm:h-[53px] sm:flex-row sm:items-stretch">
        <div className="no-scrollbar flex h-[53px] min-w-0 flex-1 overflow-x-auto sm:h-auto">
          {tabs.map((tab) => {
            const isActive = active === tab.id;
            return (
              <Link
                key={tab.id}
                href={tab.id === "foryou" ? "/home" : `/home?tab=${tab.id}`}
                data-testid={`tab-${tab.id}`}
                className="flex h-full min-w-fit flex-1 shrink-0 items-center justify-center px-4 transition-colors hover:bg-x-hover"
              >
                <span
                  className={`relative flex h-full items-center whitespace-nowrap text-[15px] ${
                    isActive ? "font-bold text-x-text" : "font-medium text-x-sec"
                  }`}
                >
                  {tab.label}
                  {"chevron" in tab && tab.chevron && <ChevronDown size={16} className="ml-0.5" />}
                  {isActive && <span className="absolute bottom-0 left-0 right-0 h-1 rounded-full bg-x-blue" />}
                </span>
              </Link>
            );
          })}
          <button className="flex h-full shrink-0 items-center justify-center px-5 text-x-sec transition-colors hover:bg-x-hover">
            <PlusIcon size={20} />
          </button>
        </div>
        {right && (
          <div className="flex min-w-0 items-center justify-end border-t border-x-border px-3 py-1.5 sm:shrink-0 sm:border-t-0 sm:py-0 sm:pl-1 sm:pr-3">
            {right}
          </div>
        )}
      </div>
    </div>
  );
}
