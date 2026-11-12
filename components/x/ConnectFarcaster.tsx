"use client";
// SIGN IN WITH X (2026-11-06) — what a root that signed in with X ONLY is told where a feature needs a Farcaster account:
// plainly, with "Connect Farcaster" (the guided run's Sign in step, /welcome#farcaster: Sign in with Farcaster as a second
// account on the SAME root, which then shows both). Nothing here reads anything: it is words and two links.
import Link from "next/link";
import { welcomeHref } from "@/lib/onboarding/state";

/** the one sentence (the owner's rule: Farcaster features that need a Farcaster account say so) */
export const NEEDS_FARCASTER =
  "You signed in with X. Your Following here is your Farcaster graph, and posting as yourself and the anonymous crowd need a Farcaster account too. Connect Farcaster to add it to this same identity.";

export function ConnectFarcaster({ what = "following" }: { what?: string }) {
  return (
    <div data-testid="connect-farcaster" data-what={what} className="border-b border-x-border px-4 py-6">
      <p className="text-[17px] font-bold leading-6">Connect Farcaster</p>
      <p className="mt-1 text-[15px] leading-5 text-x-sec">{NEEDS_FARCASTER}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={welcomeHref("farcaster")} data-testid="connect-farcaster-link" className="inline-flex h-10 items-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white">
          Connect Farcaster
        </Link>
        <Link href="/settings/import-x?return=/home#x-people" data-testid="connect-farcaster-x-people" className="text-[15px] font-bold text-x-blue hover:underline">
          Find your X follows on Farcaster
        </Link>
      </div>
      <p className="mt-2 text-[13px] leading-4 text-x-sec">X&apos;s own timeline isn&apos;t something Totem reads. Your X follows come from your X archive, which never leaves this browser.</p>
    </div>
  );
}
