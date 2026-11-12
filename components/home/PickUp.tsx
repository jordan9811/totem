"use client";
// PUBLIC GO-LIVE — "PICK UP WHERE YOU LEFT OFF": the card above the home feed after the guided first run (the owner's
// direction, 2026-11-05). Three optional rows, each the real thing or honestly not yet:
//   Find your people   FOLLOWING FROM THE HUB: how many accounts your own Farcaster account follows, read by this tab from
//                      a Farcaster node (POST /api/fc/hub {op:"count"}), and the page that lists them (/fc/following);
//                      a read that failed says so with Retry, never "0". Below it, the X archive's "which of your X follows
//                      are on Farcaster" (Settings › Import from X, components/settings/XPeoplePanel.tsx), as before.
//                      Without a Farcaster sign-in the row offers the sign-in instead.
//   Bring your X posts the existing Settings › Import from X archive import (the archive never leaves this browser).
//   Make a persona     the persona form the first run used to force (components/home/MakePersona.tsx), here and optional.
// Shown in public live mode on the visitor's own device once there is someone to be (a Farcaster sign-in or a persona),
// and to anyone sent to /home#make-persona (the composer's and the timeline's "Make a persona"). Dismissible for this
// tab (sessionStorage, the identity strip's own pattern: ephemeral UX, never data).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { MAKE_PERSONA_EVENT, welcomeHref } from "@/lib/onboarding/state";
import { followsCountSentence, type HubCountView } from "@/lib/fc/hubRead/copy";
import { hubCall } from "@/components/hub/hubCall";
import { MakePersona } from "./MakePersona";
import { useRootAccounts } from "@/components/x/useRootAccounts";

const KEY = "totem:pickup";

type CountState = { state: "loading" } | { state: "ok"; count: number; truncated: boolean } | { state: "error"; message: string };

export function PickUp() {
  const app = useApp();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const root = app.personas.find((p) => p.publicSelf === true) ?? null;
  const [count, setCount] = useState<CountState>({ state: "loading" });
  const [countTick, setCountTick] = useState(0);
  // PERSONA SEPARATION (§36): nothing is read as the root while a persona acts (the device refuses it too)
  const actingAsPersona = !!app.actingPersonaId && app.personas.some((p) => p.id === app.actingPersonaId && p.publicSelf !== true);
  // SIGN IN WITH X: a root signed in with X ONLY has no Farcaster follows to count: the row says so and offers Connect
  // Farcaster, and the X archive's X-follows-on-Farcaster stays below it. Unknown accounts change nothing.
  const accounts = useRootAccounts(app.publicLive && app.deviceIsThePage && app.rosterStatus === "ready" && !!root, app.refreshTick);
  const xOnly = !!root && !!accounts && accounts.x && !accounts.farcaster;
  const countOn = app.publicLive && app.deviceIsThePage && app.rosterStatus === "ready" && !!root && !actingAsPersona && !xOnly;
  useEffect(() => {
    if (!countOn) return;
    let alive = true;
    setCount({ state: "loading" });
    void hubCall<HubCountView>({ op: "count", retry: countTick > 0 }).then((r) => {
      if (!alive) return;
      setCount(r.ok ? { state: "ok", count: r.data.count, truncated: r.data.truncated } : { state: "error", message: r.error });
    });
    return () => {
      alive = false;
    };
  }, [countOn, countTick]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "dismissed") setDismissed(true);
    } catch {
      /* storage unavailable: the card shows */
    }
    const openForm = () => {
      setOpen(true);
      setDismissed(false);
      window.setTimeout(() => document.getElementById("pickup")?.scrollIntoView({ block: "start" }), 0);
    };
    const read = () => {
      if (window.location.hash === "#make-persona") openForm();
    };
    read();
    const later = window.setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    window.addEventListener(MAKE_PERSONA_EVENT, openForm);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener("hashchange", read);
      window.removeEventListener(MAKE_PERSONA_EVENT, openForm);
    };
  }, []);

  if (!app.publicLive || !app.deviceIsThePage || app.rosterStatus !== "ready") return null;
  const someone = app.personas.length > 0; // a Farcaster sign-in (the public self) or a persona of your own
  if (dismissed || (!someone && !open)) return null;

  const row = "flex items-start gap-3 px-4 py-3";
  return (
    <section id="pickup" data-testid="pickup" className="border-b border-x-border">
      <div className="flex items-center px-4 pt-3">
        <h2 className="flex-1 text-[17px] font-extrabold leading-6">Pick up where you left off</h2>
        <button
          type="button"
          data-testid="pickup-dismiss"
          aria-label="Dismiss"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(KEY, "dismissed");
            } catch {
              /* storage unavailable: dismissed for this page only */
            }
          }}
          className="h-8 w-8 rounded-full text-[18px] font-bold text-x-sec hover:bg-x-hover"
        >
          ×
        </button>
      </div>
      <ul className="pb-1">
        <li data-testid="pickup-people" className={row}>
          <div className="min-w-0 flex-1">
            <Link href={xOnly ? "/settings/import-x?return=/home#x-people" : root ? "/fc/following" : welcomeHref("farcaster")} prefetch={false} data-testid="pickup-people-link" className="text-[15px] font-bold hover:underline">
              Find your people
            </Link>
            {root && xOnly ? (
              <p data-testid="pickup-people-x-only" className="text-[14px] leading-5 text-x-sec">
                You signed in with X. To see the people you follow on Farcaster and their posts,{" "}
                <Link href={welcomeHref("farcaster")} data-testid="pickup-connect-farcaster" className="font-bold text-x-blue hover:underline">
                  connect Farcaster
                </Link>
                .
              </p>
            ) : root && actingAsPersona ? (
              <p data-testid="pickup-people-hidden" className="text-[14px] leading-5 text-x-sec">
                Your own Farcaster follows stay hidden while you&apos;re acting as a persona.
              </p>
            ) : root ? (
              <p data-testid="pickup-people-count" data-state={count.state} data-count={count.state === "ok" ? count.count : undefined} className="text-[14px] leading-5 text-x-sec">
                {count.state === "ok" ? (
                  <>
                    {followsCountSentence(count.count, count.truncated)}
                    {count.count > 0 ? " See who, and their posts in Following." : ""}
                  </>
                ) : count.state === "error" ? (
                  <span data-testid="pickup-people-error" role="alert" className="text-[#f4212e]">
                    {count.message}{" "}
                    <button type="button" data-testid="pickup-people-retry" onClick={() => setCountTick((t) => t + 1)} className="font-bold text-x-blue hover:underline">
                      Retry
                    </button>
                  </span>
                ) : (
                  "Reading who you follow on Farcaster…"
                )}
              </p>
            ) : (
              <p className="text-[14px] leading-5 text-x-sec">Sign in with Farcaster to see the people you follow there and their posts.</p>
            )}
            <p className="text-[14px] leading-5 text-x-sec">
              <Link href="/settings/import-x?return=/home#x-people" data-testid="pickup-people-x-link" className="font-bold text-x-blue hover:underline">
                See which of the people you follow on X are on Farcaster
              </Link>
              , from your X archive.
            </p>
          </div>
        </li>
        <li data-testid="pickup-x-posts" className={row}>
          <div className="min-w-0 flex-1">
            <Link href="/settings/import-x?return=/home" data-testid="pickup-x-posts-link" className="text-[15px] font-bold hover:underline">
              Bring your X posts
            </Link>
            <p className="text-[14px] leading-5 text-x-sec">Import your X archive. The file never leaves this browser; only the parts you pick are saved, sealed.</p>
          </div>
        </li>
        <li id="make-persona" data-testid="pickup-persona" className={row}>
          <div className="min-w-0 flex-1">
            <button type="button" data-testid="pickup-persona-open" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-left text-[15px] font-bold hover:underline">
              Make a persona
            </button>
            <p className="text-[14px] leading-5 text-x-sec">Optional: another face with its own name and picture, for the things you&apos;d rather not post as yourself.</p>
            {open ? (
              <MakePersona
                onCreated={(handle, warning) => {
                  app.toast(warning ?? "Created @" + handle + ". Posting as @" + handle + ".");
                  setOpen(false);
                  if (window.location.hash === "#make-persona") history.replaceState(null, "", window.location.pathname + window.location.search);
                  app.refresh();
                }}
              />
            ) : null}
          </div>
        </li>
      </ul>
    </section>
  );
}
