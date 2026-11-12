"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useApp } from "./Providers";
import { AccountSwitcher } from "./AccountSwitcher";
import { chromeAvatarSrc } from "./CastCard";
import { PersonaPill } from "./PersonaPill";
import { MoreMenu, type MoreEntry } from "./MoreMenu";
import { HelpGlyph } from "./help/HelpGlyph";
import { HubUnreadBadge } from "./hub/HubUnreadBadge";
import {
  ArticlesIcon,
  BellFilled,
  BellOutline,
  BookmarkOutline,
  ChatBubble,
  CreatorStudioIcon,
  GrokIcon,
  HomeFilled,
  HomeOutline,
  KebabIcon,
  MoneyIcon,
  MoreCircle,
  PremiumIcon,
  ProfileOutline,
  SearchBold,
  SearchIcon,
  SettingsGear,
  VerifiedBadge,
  TotemLogo,
} from "./icons";

interface NavEntry {
  label: string;
  href: string;
  slot: string;
  icon: (active: boolean) => React.ReactNode;
}

/** PUBLIC GO-LIVE: the destinations that exist only as fixture (demo) surfaces — left out of the rail, the More menu and
 *  the phone tab bar in public live mode, where nothing on the site may be a demo. Everywhere else they stay. */
export const FIXTURE_ONLY_SLOTS: ReadonlySet<string> = new Set(["grok", "premium", "money", "market", "creator-studio", "rooms", "channels"]);

/** Slot ids a mode may list in actionButtonSlots.nav. */
export const NAV_SLOTS = [
  "home",
  "explore",
  "notifications",
  "messages",
  "grok",
  "premium",
  "money",
  "channels",
  "rooms",
  "market",
  "history",
  "creator-studio",
  "articles",
  "profile",
] as const;

export function LeftRail({
  selfHandle,
  navSlots,
  pill,
}: {
  /** the profile link's handle. null on a public deployment until the device names the acting persona — the entry
   *  is then left out rather than pointed at the server's fixture self (the owner's profile, not the visitor's) */
  selfHandle: string | null;
  navSlots?: string[];
  /** POST-DEPLOY Gate 2: the non-colour cue, resolved server-side in the layout
   *  from the SEEDED acting persona — the same one the tint keys off, not the
   *  Providers context, which is the other identity track.
   *  PROD-LIVE: on a public deployment ChromeRoot resolves it from the device instead; `handle` is null until then. */
  pill?: { handle: string | null; modeName: string | null; pending?: boolean; onRetry?: () => void; none?: boolean };
}) {
  const pathname = usePathname();
  const { activePersona, setComposeOpen, deviceIsThePage, emptyWorld, rosterStatus, rosterError, publicLive } = useApp();
  // LAYERS_WORLD=empty (review WORLD-LEAK-1): the owner service is rig-shaped (the device is not the page), but its
  // demo world is hidden — the fixture fallbacks below are the demo self's, so they are off there too
  const noFixture = deviceIsThePage || emptyWorld;
  // LAYERS_WORLD=empty (review WORLD-ID-3, one identity): the rail's Profile entry is the ACTING persona's — the
  // server's self handle is the demo self's in the demo world and the FIRST real persona's here, which is not the one
  // the pill names once there are two. Absent while there is no persona yet.
  const profileHandle = emptyWorld ? activePersona?.handle ?? null : selfHandle;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [more, setMore] = useState<{ left: number; bottom: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMore(null), []);

  const IC = 26.25;
  const everyNav: NavEntry[] = [
    { slot: "home", label: "Home", href: "/home", icon: (a) => (a ? <HomeFilled size={IC} /> : <HomeOutline size={IC} />) },
    { slot: "explore", label: "Explore", href: "/explore", icon: (a) => (a ? <SearchBold size={IC} /> : <SearchIcon size={IC} />) },
    { slot: "notifications", label: "Notifications", href: "/notifications", icon: (a) => (a ? <BellFilled size={IC} /> : <BellOutline size={IC} />) },
    { slot: "messages", label: "Chat", href: "/messages", icon: () => <ChatBubble size={IC} /> },
    { slot: "grok", label: "SuperGrok", href: "/grok", icon: () => <GrokIcon size={IC} /> },
    { slot: "premium", label: "Premium+", href: "/premium", icon: () => <PremiumIcon size={IC} /> },
    { slot: "money", label: "Money", href: "/money", icon: () => <MoneyIcon size={IC} /> },
    { slot: "channels", label: "Channels", href: "/channels", icon: () => <ChatBubble size={IC} /> },
    { slot: "rooms", label: "Spaces", href: "/rooms", icon: () => <MoreCircle size={IC} /> },
    { slot: "market", label: "Market", href: "/market", icon: () => <MoneyIcon size={IC} /> },
    { slot: "history", label: "History", href: "/history", icon: () => <BookmarkOutline size={IC} /> },
    { slot: "creator-studio", label: "Creator Studio", href: "/creator-studio", icon: () => <CreatorStudioIcon size={IC} /> },
    { slot: "articles", label: "Articles", href: "/articles", icon: () => <ArticlesIcon size={IC} /> },
    // PROD-LIVE: absent (not mis-pointed) while a public deployment's device has not named the persona yet
    ...(profileHandle ? [{ slot: "profile", label: "Profile", href: "/" + profileHandle, icon: () => <ProfileOutline size={IC} /> } as NavEntry] : []),
  ];
  // PUBLIC GO-LIVE: no fixture-only destination in live mode (not in the rail, and so not in the More menu either)
  const allNav = publicLive ? everyNav.filter((n) => !FIXTURE_ONLY_SLOTS.has(n.slot)) : everyNav;

  // A mode that names nav slots gets exactly those, in the mode's order.
  // Same reasoning as the composer half: fail OPEN, because failing closed on
  // navigation strands the user on a page with no way out.
  const nav = navSlots?.length
    ? (navSlots.map((sl) => allNav.find((n) => n.slot === sl)).filter(Boolean) as NavEntry[])
    : allNav;
  // PROD-LIVE: whatever the mode's slots hid is still one click away, in the More menu
  const hiddenNav: MoreEntry[] = allNav
    .filter((n) => !nav.includes(n))
    .map((n) => ({ slot: n.slot, label: n.label, href: n.href, icon: n.icon(false) }));

  // PROD-LIVE: the fixture fallbacks ("jordan", the server's self handle, a stock avatar) are the rig's. On a public
  // deployment they would name the OWNER to a stranger, so the account button says what it knows instead.
  const handle = activePersona?.handle ?? (noFixture ? null : selfHandle);
  const name =
    activePersona?.name ??
    (emptyWorld ? "No persona yet" : deviceIsThePage ? (rosterStatus === "error" ? "Personas unavailable" : "Your persona") : "jordan");
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <header data-chrome="rail-left" className="persona-chrome sticky top-0 hidden h-screen shrink-0 flex-col items-end sm:flex w-[88px] xl2:w-[275px]">
      <div className="flex h-full w-[88px] flex-col overflow-y-auto no-scrollbar px-2 xl2:w-[275px]">
        <div className="flex flex-col items-center xl2:items-start">
          {pill && <PersonaPill handle={pill.handle} modeName={pill.modeName} variant="rail" pending={pill.pending} onRetry={pill.onRetry} none={pill.none} />}
          <Link
            href="/home"
            aria-label="Totem"
            className="my-0.5 flex h-[50px] w-[50px] items-center justify-center rounded-full hover:bg-x-hover"
          >
            <TotemLogo size={30} />
          </Link>

          <nav className="mt-0.5 flex w-full flex-col items-center xl2:items-start">
            {nav.map((item) => {
              const active =
                item.href === "/home" ? pathname === "/home" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  data-testid="nav-item"
                  data-slot={item.slot}
                  className="group flex w-full justify-center py-1 xl2:justify-start"
                >
                  <div className="flex items-center rounded-full p-3 group-hover:bg-[#0f14191a]">
                    {item.slot === "notifications" ? (
                      // NOTIFICATIONS FROM FARCASTER: the unread badge, only while the root acts on the live site
                      <span className="relative inline-flex">
                        {item.icon(active)}
                        <HubUnreadBadge variant="rail" />
                      </span>
                    ) : (
                      item.icon(active)
                    )}
                    <span
                      className={`ml-5 mr-4 hidden text-xl leading-6 xl2:block ${active ? "font-bold" : "font-normal"}`}
                    >
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
            {/* PROD-LIVE: Settings is OUTSIDE the mode-slot list on purpose — no mode's nav slots can hide the one road
                to the settings that change modes (the owner's #1 complaint on the preview: "no way to access
                settings"). Its own testid, so the nav-item count a mode's slots produce (accept-m3) is unchanged. */}
            <Link
              href="/settings"
              data-testid="nav-settings"
              aria-label="Settings"
              className="group flex w-full justify-center py-1 xl2:justify-start"
            >
              <div className="flex items-center rounded-full p-3 group-hover:bg-[#0f14191a]">
                <SettingsGear size={IC} />
                <span className={`ml-5 mr-4 hidden text-xl leading-6 xl2:block ${settingsActive ? "font-bold" : "font-normal"}`}>
                  Settings
                </span>
              </div>
            </Link>
            {/* HELP: outside the mode-slot list for the same reason as Settings (no mode can hide the road to "how does
                this work?"), with its own testid so accept-m3's nav-item counts are unchanged. A next/link: /help is
                outside the app group, and a soft navigation keeps this tab's document, device and unsaved identity. */}
            <Link
              href="/help"
              data-testid="nav-help"
              aria-label="Help"
              className="group flex w-full justify-center py-1 xl2:justify-start"
            >
              <div className="flex items-center rounded-full p-3 group-hover:bg-[#0f14191a]">
                <HelpGlyph size={IC} />
                <span className="ml-5 mr-4 hidden text-xl leading-6 font-normal xl2:block">Help</span>
              </div>
            </Link>
            <button
              ref={moreRef}
              type="button"
              data-testid="nav-more"
              aria-haspopup="menu"
              aria-expanded={more !== null}
              onClick={() => {
                if (more) return setMore(null);
                const r = moreRef.current?.getBoundingClientRect();
                setMore(r ? { left: r.left, bottom: r.bottom } : { left: 8, bottom: 8 });
              }}
              className="group flex w-full justify-center py-1 xl2:justify-start"
            >
              <div className="flex items-center rounded-full p-3 group-hover:bg-[#0f14191a]">
                <MoreCircle size={IC} />
                <span className="ml-5 mr-4 hidden text-xl leading-6 font-normal xl2:block">More</span>
              </div>
            </button>
            {more && <MoreMenu anchor={more} hidden={hiddenNav} onClose={closeMore} />}
          </nav>

          <button
            data-testid="nav-post-button"
            onClick={() => setComposeOpen(true)}
            className="mt-3 flex h-[50px] w-[50px] items-center justify-center rounded-full bg-x-black-btn text-[17px] font-bold text-white shadow-sm hover:bg-x-black-btn-hover xl2:h-[52px] xl2:w-[90%]"
          >
            <span className="hidden xl2:block">Post</span>
            <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" className="xl2:hidden">
              <path d="M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z" />
            </svg>
          </button>
        </div>

        <div className="relative mt-auto mb-3 w-full">
          {switcherOpen && <AccountSwitcher onClose={() => setSwitcherOpen(false)} />}
          <button
            data-testid="account-switcher-button"
            onClick={() => setSwitcherOpen((v) => !v)}
            title={deviceIsThePage && rosterStatus === "error" && rosterError ? "Could not read your personas: " + rosterError : undefined}
            className="flex w-full items-center justify-center rounded-full p-3 hover:bg-x-hover xl2:justify-start"
          >
            {noFixture && !chromeAvatarSrc(activePersona) ? (
              <span aria-hidden className={"h-10 w-10 shrink-0 rounded-full bg-x-pill" + (deviceIsThePage && rosterStatus === "loading" ? " skeleton" : "")} />
            ) : (
              <img
                src={chromeAvatarSrc(activePersona) ?? "https://i.pravatar.cc/160?img=12"}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            )}
            <div className="ml-3 hidden min-w-0 flex-1 flex-col items-start xl2:flex">
              <span className="flex max-w-full items-center text-[15px] font-bold leading-5">
                <span className={"truncate" + (deviceIsThePage && !activePersona && rosterStatus === "error" ? " text-[#f4212e]" : "")}>{name}</span>
                {!emptyWorld && (activePersona || !deviceIsThePage) ? <VerifiedBadge size={16} className="ml-0.5 shrink-0" /> : null}
              </span>
              <span className="text-[15px] leading-5 text-x-sec">{handle ? <>@{handle}</> : emptyWorld ? "open to create one" : rosterStatus === "error" ? "open to retry" : "…"}</span>
            </div>
            <span className="ml-2 hidden text-x-text xl2:block">
              <KebabIcon size={18.75} />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
