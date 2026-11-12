"use client";
// PROD-LIVE — the left rail's "More" menu (it was a dead button). The owner's #1 complaint on the public preview was
// "no way to access settings"; the rail now carries an always-visible Settings entry (LeftRail, nav-settings), and
// this menu is the second road: Settings, Help (more-help, /help), the visitor's device page, and every nav entry the
// active mode's nav slots hid — a mode can narrow the rail, it can never make a destination unreachable.
//
// Every entry is a next/link. On a public deployment an unsaved identity lives only in this tab's memory, so a full
// document load (a plain <a href="/...">) would wipe it and mint a stranger; a soft navigation keeps it.
//
// PROD-LIVE: "Your device" (more-device) is offered ONLY when the device is the page (useApp().deviceIsThePage). On
// the rig and the owner service the server answers /api/* itself, and /device starts an ephemeral in-browser device
// whose fetch patch stays installed in the document — a soft navigation back into the app then silently re-pointed
// the rig app's every /api/* read and write at that throwaway root. Those servers hold their identity themselves;
// there is nothing for the visitor's device page to save there.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useApp } from "./Providers";
import { SettingsGear } from "./icons";
import { HelpGlyph } from "./help/HelpGlyph";

/** a phone outline — "the device this identity lives on" (shared with the mobile drawer) */
export function DeviceGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

export interface MoreEntry {
  slot: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

export function MoreMenu({
  anchor,
  hidden,
  onClose,
}: {
  /** the More button's rect when the menu opened — the menu is fixed-positioned so the rail's scroller cannot clip it */
  anchor: { left: number; bottom: number } | null;
  hidden: MoreEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { deviceIsThePage } = useApp();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (ref.current && t && !ref.current.contains(t) && !t.closest("[data-testid=nav-more]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const style: React.CSSProperties = anchor
    ? { left: Math.max(8, anchor.left), bottom: Math.max(8, vh - anchor.bottom) }
    : { left: 8, bottom: 8 };
  const row = "flex w-full items-center gap-3 px-4 py-3 text-[17px] font-bold leading-5 text-x-text hover:bg-x-hover";

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="more-menu"
      style={style}
      className="fixed z-[60] max-h-[80vh] w-[260px] overflow-y-auto rounded-2xl bg-white py-2 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]"
    >
      {hidden.map((n) => (
        <Link key={n.slot} href={n.href} role="menuitem" data-testid="more-item" data-slot={n.slot} className={row} onClick={onClose}>
          <span className="shrink-0">{n.icon}</span>
          <span className="truncate">{n.label}</span>
        </Link>
      ))}
      {hidden.length ? <div className="my-1 border-t border-x-border" /> : null}
      <Link href="/settings" role="menuitem" data-testid="more-settings" className={row} onClick={onClose}>
        <span className="shrink-0">
          <SettingsGear size={22} />
        </span>
        <span>Settings</span>
      </Link>
      {/* HELP: on every deployment (rig, owner service, public). /help is outside the app group and reads nothing, so
          unlike /device it starts no device of its own: the soft navigation back finds this tab's device unchanged. */}
      <Link href="/help" role="menuitem" data-testid="more-help" className={row} onClick={onClose}>
        <span className="shrink-0">
          <HelpGlyph size={22} />
        </span>
        <span className="min-w-0">
          <span className="block">Help</span>
          <span className="block text-[13px] font-normal text-x-sec">How Totem works, and what works today</span>
        </span>
      </Link>
      {deviceIsThePage ? (
        <Link href="/device" role="menuitem" data-testid="more-device" className={row} onClick={onClose}>
          <span className="shrink-0" aria-hidden>
            <DeviceGlyph size={22} />
          </span>
          <span className="min-w-0">
            <span className="block">Your device</span>
            <span className="block text-[13px] font-normal text-x-sec">Save this identity, your 24 words, linked devices</span>
          </span>
        </Link>
      ) : null}
    </div>
  );
}
