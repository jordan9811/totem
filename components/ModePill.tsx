"use client";
// Current (persona, mode) pair always visible in the header, one tap to
// switch mode, cycle arrows to swipe between the CURRENT persona's own
// modes without switching persona. Matches X's existing header-control
// language: pill shape, #eff3f4 fill, 15px bold, same hover treatment as
// the tab row.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ModeDefinition } from "@/lib/adapters/types";
import { ChevronDown } from "./icons";
import { useApp } from "./Providers";

export interface ActivePersonaInfo {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}

export function ModePill({
  initialModes,
  initialActiveId,
  activePersona,
}: {
  initialModes: ModeDefinition[];
  initialActiveId: string;
  /** UX Gate 1: the (persona, mode) pair — persona display + the set this
   * pill may CYCLE through via the arrows without a persona-switch side
   * effect (modes pinned to a DIFFERENT persona are excluded from the
   * cycle; they're still reachable from the dropdown below, where picking
   * one is a deliberate mode+persona choice, not a same-persona swipe). */
  activePersona?: ActivePersonaInfo;
}) {
  // PROD-LIVE (D-CU-0-4): a mode switch changes the CHROME too (the pill's mode name, the mode edge, the nav
  // slots), and on a public deployment that chrome and this pill's own data are read by the browser device, not
  // the server — so the switch ends in Providers.refresh(): a refetch of every island (the tick alone there — the
  // public server render has nothing identity-bearing to re-render). On the rig that is router.refresh(), as before
  // (islands handed server data ignore the refetch tick).
  const { refresh } = useApp();
  const [modes, setModes] = useState(initialModes);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setModes(initialModes);
    setActiveId(initialActiveId);
  }, [initialModes, initialActiveId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const active = modes.find((m) => m.id === activeId);
  const cyclable = modes.filter((m) => !m.pinnedPersonaId || m.pinnedPersonaId === activePersona?.id);

  async function pick(modeId: string) {
    setSwitching(modeId);
    setError(null);
    try {
      const res = await fetch("/api/modes/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modeId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "switch failed");
      setActiveId(modeId);
      setOpen(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSwitching(null);
    }
  }

  function swipe(dir: -1 | 1) {
    if (!cyclable.length) return;
    const i = cyclable.findIndex((m) => m.id === activeId);
    // wraps; if the current mode isn't in the cyclable set (a pinned mode
    // reached via the dropdown), start from the first one
    const next = cyclable[((i < 0 ? 0 : i) + dir + cyclable.length) % cyclable.length];
    if (next.id !== activeId) pick(next.id);
  }

  // PROD-LIVE (mobile): the handle is the one part of this control whose width the visitor does not choose (a device
  // persona is `you_4da852`, a created one up to 30 characters), so it is the part that gives way — it truncates
  // (full handle in the title) instead of pushing the mode pill off the row. The pill and the arrows never shrink.
  return (
    <div ref={ref} className="relative flex min-w-0 items-center" data-testid="persona-mode-header">
      {activePersona && (
        <span
          data-testid="header-active-persona"
          data-persona-id={activePersona.id}
          title={"@" + activePersona.handle}
          className="mr-1.5 flex min-w-0 items-center gap-1 text-[13px] font-bold text-x-sec"
        >
          {activePersona.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activePersona.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
          ) : null}
          <span className="max-w-[40vw] truncate sm:max-w-[180px]">@{activePersona.handle}</span>
        </span>
      )}

      {cyclable.length > 1 && (
        <button
          data-testid="mode-swipe-prev"
          aria-label="Previous mode"
          onClick={() => swipe(-1)}
          disabled={switching !== null}
          className="mr-0.5 flex h-8 w-6 shrink-0 items-center justify-center rounded-full text-x-sec hover:bg-x-hover disabled:opacity-50"
        >
          ‹
        </button>
      )}

      <button
        data-testid="mode-pill"
        data-active-mode={active?.name ?? ""}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 shrink-0 items-center rounded-full bg-x-pill px-3 text-[14px] font-bold text-x-text transition-colors hover:bg-[#e1e8ed]"
      >
        <span className="mr-1 h-2 w-2 rounded-full bg-x-blue" />
        {active?.name ?? "Mode"}
        <ChevronDown size={16} className="ml-0.5" />
      </button>

      {cyclable.length > 1 && (
        <button
          data-testid="mode-swipe-next"
          aria-label="Next mode"
          onClick={() => swipe(1)}
          disabled={switching !== null}
          className="ml-0.5 flex h-8 w-6 shrink-0 items-center justify-center rounded-full text-x-sec hover:bg-x-hover disabled:opacity-50"
        >
          ›
        </button>
      )}

      {open && (
        <div
          data-testid="mode-menu"
          className="absolute right-0 top-10 z-50 w-[260px] overflow-hidden rounded-2xl bg-white py-1 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]"
        >
          <p className="px-4 py-2 text-[13px] font-bold text-x-sec">Switch mode</p>
          {modes.map((mode) => (
            <button
              key={mode.id}
              data-testid={`mode-option-${mode.name.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => pick(mode.id)}
              disabled={switching !== null}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-x-hover disabled:opacity-60"
            >
              <span>
                <span className="block text-[15px] font-bold leading-5">
                  {mode.name}
                  {mode.pinnedPersonaId && mode.pinnedPersonaId !== activePersona?.id && (
                    <span className="ml-1.5 rounded-full bg-[#eff3f4] px-1.5 py-0.5 text-[11px] font-bold text-x-sec">
                      switches persona
                    </span>
                  )}
                </span>
                <span className="block text-[13px] leading-4 text-x-sec">
                  {mode.showTrending ? "Trending on" : "Trending off"} · {mode.notificationPolicy.replace("_", " ")}
                </span>
              </span>
              {switching === mode.id ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
              ) : mode.id === activeId ? (
                <svg viewBox="0 0 24 24" width={18} height={18} fill="#00ba7c">
                  <path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z" />
                </svg>
              ) : null}
            </button>
          ))}
          {error && <p className="px-4 py-2 text-[13px] text-[#f4212e]">{error}</p>}
          {/* PROD-LIVE: a client navigation, never a full document load — on a public deployment an unsaved visitor
              identity lives only in tab memory, and a full load wipes it and mints a new one */}
          <Link
            href="/settings/persona-mode"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="mt-1 block border-t border-x-border px-4 py-3 text-[15px] font-bold text-x-blue hover:bg-x-hover"
          >
            Manage modes &amp; bindings
          </Link>
        </div>
      )}
    </div>
  );
}
