"use client";
// MEGA PASS 2 Gate 3 — THE SCROLL ROUTER. With no zones configured this
// renders its children and attaches nothing: the browser scrolls the
// timeline exactly as it always did (X parity). With a reading layout it
// routes wheel and touch scrolling by WHERE the pointer is: inside a
// `longform` zone, the nearest long-form container under the pointer
// scrolls its own body; everywhere else — the outer band — the timeline
// scrolls. Reading an article never ejects you from the feed.
//
// The routing is a pure hit-test (lib/zones/types.ts) on the live
// viewport; nothing here is persisted or reported. Mobile behaviour is
// UNMEASURED in this build (Playwright's synthetic wheel/touch is what the
// suite drives); real-device tuning is required.
import { useEffect, useRef } from "react";
import { hitTest, type ZoneConfig } from "@/lib/zones/types";

export const LONGFORM_SELECTOR = '[data-scroll-target="longform"]';

function longformUnder(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest(LONGFORM_SELECTOR) as HTMLElement | null) ?? null;
}

/** scroll the container by dy if it can move that way; false = at its bound (let the page take it) */
function scrollLongform(el: HTMLElement, dy: number): boolean {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return false;
  const before = el.scrollTop;
  const next = Math.max(0, Math.min(max, before + dy));
  if (next === before) return false;
  el.scrollTop = next;
  return true;
}

export function ScrollZoneShell({ config, children }: { config: ZoneConfig | null; children: React.ReactNode }) {
  const touchStart = useRef<{ x: number; y: number; el: HTMLElement | null } | null>(null);
  const active = !!config && config.zones.length > 0;

  useEffect(() => {
    if (!active || !config) return;
    const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
    const onWheel = (e: WheelEvent) => {
      if (hitTest(config, e.clientX, e.clientY, viewport()) !== "longform") return; // the outer band: the timeline scrolls as ever
      const el = longformUnder(e.clientX, e.clientY);
      if (!el) return; // nothing long-form under the pointer: fall through to the timeline
      if (scrollLongform(el, e.deltaY)) e.preventDefault();
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchStart.current = { x: t.clientX, y: t.clientY, el: hitTest(config, t.clientX, t.clientY, viewport()) === "longform" ? longformUnder(t.clientX, t.clientY) : null };
    };
    const onTouchMove = (e: TouchEvent) => {
      const s = touchStart.current;
      const t = e.touches[0];
      if (!s || !t || !s.el) return;
      const dy = s.y - t.clientY;
      touchStart.current = { ...s, y: t.clientY };
      if (scrollLongform(s.el, dy)) e.preventDefault();
    };
    const onTouchEnd = () => {
      touchStart.current = null;
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchend", onTouchEnd, { capture: true } as EventListenerOptions);
    };
  }, [active, config]);

  return (
    <div data-testid="scroll-zone-shell" data-layout={config?.layout ?? "default"} data-zones={config?.zones.length ?? 0}>
      {children}
    </div>
  );
}
