"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "./Providers";
import { useChromeScope } from "./ChromeScope";
import { chromeAvatarSrc } from "./CastCard";
import { DeviceGlyph } from "./MoreMenu";
import { HelpGlyph } from "./help/HelpGlyph";
import { HubUnreadBadge } from "./hub/HubUnreadBadge";
import { formatFull } from "@/lib/format";
import {
  BellFilled,
  BellOutline,
  ChatBubble,
  GrokIcon,
  HomeFilled,
  HomeOutline,
  SearchBold,
  SearchIcon,
  SettingsGear,
  VerifiedBadge,
  TotemLogo,
} from "./icons";

export function MobileHeader() {
  const { activePersona, deviceIsThePage, emptyWorld, rosterStatus } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <div className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-x-border bg-white/85 px-4 backdrop-blur-md sm:hidden">
        <button onClick={() => setDrawerOpen(true)} aria-label="Account menu" data-testid="mobile-account-button">
          {(deviceIsThePage || emptyWorld) && !chromeAvatarSrc(activePersona) ? (
            // PROD-LIVE: no stock face standing in for a persona the device has not named yet
            <span aria-hidden className={"block h-8 w-8 rounded-full bg-x-pill" + (rosterStatus === "loading" ? " skeleton" : "")} />
          ) : (
            <img
              src={chromeAvatarSrc(activePersona) ?? "https://i.pravatar.cc/160?img=12"}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
          )}
        </button>
        <TotemLogo size={24} />
        <span className="w-8" />
      </div>
      {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
    </>
  );
}

// PROD-LIVE (D-CU-0-4): the drawer is the phone's only road to Settings and to the visitor's device page, so both are
// here (next/link: a full load would wipe an unsaved identity); the device page only where the device IS the page. The fixture fallbacks — the owner's name, handle and
// follower counts — are the RIG's; on a public deployment the drawer says what the device knows, and the roster has
// the same loading / error / fail-closed-scope behaviour as the desktop switcher.
// Exported for the node render check only (review WORLD-LEAK-1: the drawer renders on the client, so a page fetch
// never sees it; the identity-unit harness renders it with react-dom/server under the flag and scans for the
// fixture needles). MobileHeader is its only product mount.
export function MobileDrawer({ onClose }: { onClose: () => void }) {
  const { activePersona, personas: roster, switchPersona, switchToRoot, actingAsYou, publicLive, deviceIsThePage, emptyWorld, rosterStatus, rosterError, refresh } = useApp();
  const scope = useChromeScope();
  const personas = deviceIsThePage && scope !== "normal" ? (activePersona ? [activePersona] : []) : roster;
  const pub = deviceIsThePage;
  // LAYERS_WORLD=empty (review WORLD-LEAK-1): the owner service is rig-shaped, but its demo world is hidden — no
  // fixture name, handle, face, check mark or follower counts (they are the demo self's), exactly as on a public
  // deployment; the counts are not shown for a real persona either (the drawer has no real counts to show)
  const noFixture = pub || emptyWorld;
  const handle = activePersona?.handle ?? (noFixture ? null : "yeak__");
  return (
    <div className="fixed inset-0 z-[80] sm:hidden" onClick={onClose} data-testid="mobile-drawer">
      <div className="absolute inset-0 bg-[#5b708366]" />
      <div
        className="absolute left-0 top-0 h-full w-[280px] overflow-y-auto bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {noFixture && !chromeAvatarSrc(activePersona) ? (
          <span aria-hidden className={"block h-10 w-10 rounded-full bg-x-pill" + (pub && rosterStatus === "loading" ? " skeleton" : "")} />
        ) : (
          <img
            src={chromeAvatarSrc(activePersona) ?? "https://i.pravatar.cc/160?img=12"}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        )}
        <p className="mt-2 flex items-center text-[17px] font-extrabold">
          {activePersona?.name ?? (emptyWorld ? "No persona yet" : pub ? (rosterStatus === "error" ? "Personas unavailable" : "Your persona") : "jordan")}
          {!emptyWorld && (activePersona || !pub) ? <VerifiedBadge size={16} className="ml-0.5" /> : null}
        </p>
        {handle ? <p className="text-[15px] text-x-sec">@{handle}</p> : null}
        {pub && rosterStatus === "error" ? (
          <div data-testid="drawer-roster-error" className="mt-2 rounded-2xl border border-[#fdc9ce] bg-[#f4212e0d] p-3">
            <p className="text-[14px] leading-5 text-[#f4212e]">Couldn&apos;t read your personas{rosterError ? ": " + rosterError : "."}</p>
            <button type="button" onClick={refresh} className="mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white">
              Retry
            </button>
          </div>
        ) : null}
        {noFixture ? null : (
          <div className="mt-2 flex gap-4 text-[14px]">
            <span>
              <span className="font-bold">{formatFull(1162)}</span>
              <span className="text-x-sec"> Following</span>
            </span>
            <span>
              <span className="font-bold">{formatFull(4242)}</span>
              <span className="text-x-sec"> Followers</span>
            </span>
          </div>
        )}
        <nav className="mt-6 flex flex-col gap-1 text-xl font-bold">
          {handle ? (
            <Link href={`/${handle}`} className="py-3" onClick={onClose}>
              Profile
            </Link>
          ) : null}
          <Link href="/history" className="py-3" onClick={onClose}>
            History
          </Link>
          <Link href="/notifications" className="py-3" onClick={onClose}>
            Notifications
          </Link>
          <Link href="/settings" data-testid="drawer-settings" className="flex items-center gap-3 py-3" onClick={onClose}>
            <SettingsGear size={22} />
            Settings
          </Link>
          {/* HELP: every deployment. The 5-icon tab bar has no room, so the drawer is the phone's road to /help; a
              next/link like every entry here (/help sits outside the app group and starts no device) */}
          <Link href="/help" data-testid="drawer-help" className="flex items-center gap-3 py-3" onClick={onClose}>
            <HelpGlyph size={22} />
            Help
          </Link>
          {/* PROD-LIVE: public deployments only — on the rig / owner service /device boots a throwaway in-browser
              device whose fetch patch outlives a soft navigation back and re-points this app's /api/* at it
              (components/MoreMenu.tsx says the same for more-device) */}
          {pub ? (
            <Link href="/device" data-testid="drawer-device" className="flex items-center gap-3 py-3" onClick={onClose}>
              <DeviceGlyph size={22} />
              Your device
            </Link>
          ) : null}
        </nav>
        {personas.length > 1 && (
          <div className="mt-6 border-t border-x-border pt-3">
            <p className="mb-2 text-[13px] font-bold text-x-sec">Switch persona</p>
            {personas.map((p) => (
              <button
                key={p.id}
                data-testid={p.publicSelf === true && publicLive && pub ? "drawer-switch-you" : undefined}
                data-acting={p.publicSelf === true && publicLive && pub ? (actingAsYou ? "true" : "false") : undefined}
                onClick={() => {
                  // ACTING AS YOURSELF (lib/device/actingRoot.ts): on the live site the visitor's own account is "You"
                  if (p.publicSelf === true && publicLive && pub) {
                    if (!actingAsYou) void switchToRoot();
                  } else switchPersona(p.id);
                  onClose();
                }}
                className="flex w-full items-center py-2"
              >
                {noFixture && !chromeAvatarSrc(p) ? (
                  <span aria-hidden className="mr-2 h-8 w-8 shrink-0 rounded-full bg-x-pill" />
                ) : (
                  <img
                    src={chromeAvatarSrc(p) ?? "https://i.pravatar.cc/160?img=12"}
                    alt=""
                    className="mr-2 h-8 w-8 rounded-full object-cover"
                  />
                )}
                <span className="text-[15px] font-bold">{p.publicSelf === true && publicLive && pub ? <>You · @{p.handle}</> : <>@{p.handle}</>}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// PUBLIC GO-LIVE: in public live mode the phone tab bar has no Grok tab (a fixture-only surface: LeftRail
// FIXTURE_ONLY_SLOTS); its place goes to Settings. With the flag off the bar is exactly as before.
export function MobileTabBar() {
  const pathname = usePathname();
  const { publicLive } = useApp();
  const items = [
    {
      href: "/home",
      icon: (a: boolean) => (a ? <HomeFilled size={26} /> : <HomeOutline size={26} />),
      label: "Home",
    },
    {
      href: "/explore",
      icon: (a: boolean) => (a ? <SearchBold size={26} /> : <SearchIcon size={26} />),
      label: "Search",
    },
    publicLive
      ? { href: "/settings", icon: () => <SettingsGear size={26} />, label: "Settings" }
      : { href: "/grok", icon: () => <GrokIcon size={26} />, label: "Grok" },
    {
      href: "/notifications",
      icon: (a: boolean) => (a ? <BellFilled size={26} /> : <BellOutline size={26} />),
      label: "Notifications",
    },
    { href: "/messages", icon: () => <ChatBubble size={26} />, label: "Chat" },
  ];
  return (
    <nav data-chrome="tabbar" className="persona-chrome fixed bottom-0 left-0 right-0 z-30 flex h-[53px] items-center justify-around border-t border-x-border bg-white sm:hidden">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-label={it.label} className="relative p-2">
          {it.icon(pathname.startsWith(it.href))}
          {/* NOTIFICATIONS FROM FARCASTER: the unread badge, only while the root acts on the live site */}
          {it.href === "/notifications" ? <HubUnreadBadge variant="tabbar" /> : null}
        </Link>
      ))}
    </nav>
  );
}

export function MobileFab() {
  const { setComposeOpen } = useApp();
  return (
    <button
      onClick={() => setComposeOpen(true)}
      aria-label="Compose"
      className="fixed bottom-[72px] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-x-blue text-white shadow-lg sm:hidden"
    >
      <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor">
        <path d="M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z" />
      </svg>
    </button>
  );
}
