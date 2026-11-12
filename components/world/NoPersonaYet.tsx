"use client";
// LAYERS_WORLD=empty (lib/world.ts) — what a page says when this device has no real persona yet.
//
// The demo world is hidden, so there is no seeded "you" to fall back on: the acting persona is "" and a page that
// needs one says so plainly and points at the one place a first persona is made (Settings → Account & Personas,
// a plain create; a fork needs a persona to fork FROM). A soft navigation (next/link), like every settings link.
//
// PUBLIC GO-LIVE (public live mode, Providers.publicLive): the visitor's device runs the empty world too, and the first
// persona is made in the guided first run — so there the page points at /welcome ("Make your first persona") instead.
// A client component only to read that flag; on the rig and the owner service it renders exactly what it did.
// PUBLIC GO-LIVE (the owner's flow, 2026-11-05): a persona is optional and is made on the home feed's "Pick up where you
// left off" card (/home#make-persona), never in the first run. A visitor signed in with Farcaster (the root) is told,
// honestly, that a timeline is built for a persona today; a guest is offered Sign in with Farcaster (/welcome#next, past
// the welcome screen: F8).
import Link from "next/link";
import { useApp } from "@/components/Providers";
import { MAKE_PERSONA_EVENT, MAKE_PERSONA_HREF, welcomeHref } from "@/lib/onboarding/state";

export function NoPersonaYet({ what }: { what: string }) {
  const { publicLive, personas } = useApp();
  if (publicLive) {
    const root = personas.find((p) => p.publicSelf === true) ?? null;
    return (
      <div data-testid="world-no-persona" data-mode="live" data-root={root ? "true" : "false"} className="border-b border-x-border px-6 py-10 text-center">
        <p className="text-[20px] font-black leading-6">{root ? "Nothing to show here yet" : "Sign in to see yours"}</p>
        <p className="mx-auto mt-2 max-w-[420px] text-[15px] leading-5 text-x-sec">
          {root
            ? `${what} is built for a persona today; showing it for @${root.handle} itself is coming soon. A persona takes a minute, and it's optional.`
            : `${what} starts with your Farcaster account. Signing in only reads your public profile.`}
        </p>
        <Link
          href={root ? MAKE_PERSONA_HREF : welcomeHref("next")}
          onClick={root ? () => window.dispatchEvent(new Event(MAKE_PERSONA_EVENT)) : undefined}
          data-testid="world-no-persona-link"
          className="mt-4 inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white"
        >
          {root ? "Make a persona" : "Sign in with Farcaster"}
        </Link>
        {/* F8: a guest has nothing else to read here in live mode (no demo world); the anonymous feed needs no account */}
        <p className="mt-3 text-[14px] text-x-sec">
          Just looking?{" "}
          <Link href="/anon" data-testid="world-no-persona-anon" className="font-bold text-x-blue hover:underline">
            Read the anonymous feed
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div data-testid="world-no-persona" className="border-b border-x-border px-6 py-10 text-center">
      <p className="text-[20px] font-black leading-6">No personas yet</p>
      <p className="mx-auto mt-2 max-w-[420px] text-[15px] leading-5 text-x-sec">
        This service shows only what is real — there are no demo accounts here. {what} starts with a persona of your
        own: create one in Settings &rsaquo; Account &amp; Personas (once you have one, that page links to its fork).
      </p>
      <Link
        href="/settings/account"
        data-testid="world-no-persona-link"
        className="mt-4 inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white"
      >
        Create a persona
      </Link>
    </div>
  );
}
