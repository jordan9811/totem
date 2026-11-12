import type { Metadata } from "next";
import Link from "next/link";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { readTarget } from "@/lib/onboarding/state";

// PUBLIC GO-LIVE — /welcome, THE GUIDED FIRST RUN (components/onboarding/Onboarding.tsx). Inside the app group, so the
// visitor's browser device boots here as on every app page (the landing's "Get started" door is a full document load
// into it, like "Enter the app"). The server renders a shell and reads nothing: on a public deployment it holds no
// identity, and every fact the flow needs is the device's.
//
// /welcome?from=anon is the anon page's click-through: it starts past the welcome screen, and a device that already
// holds a public self resumes at the step after Farcaster. /welcome#unlock opens "I've used Totem before".
// PUBLIC GO-LIVE (F5): an explicit target lands on that step (even for a returning visitor that is done): the app's own
// links put it in the hash (/welcome#farcaster, #next, #unlock: lib/onboarding/state.ts welcomeHref), read in the page
// because a hash never reaches the server; ?step=<target> is read here too (a hand-typed or older link).
//
// On the rig and the owner service (their app pages run no browser device) there is no guided first run: the page says
// where the same things live there.
export const metadata: Metadata = { title: "Welcome / Totem" };
export const dynamic = "force-dynamic";

export default function WelcomePage({ searchParams }: { searchParams: { from?: string; step?: string } }) {
  if (!isPublicDeployment()) {
    return (
      <div data-testid="onboard-not-here" className="px-4 py-10">
        <h1 className="text-[24px] font-extrabold leading-7">Welcome to Totem</h1>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">
          The guided first run is the public site&apos;s: it runs in your browser there. On this service your personas, sign-in and saving live in Settings.
        </p>
        <Link href="/settings/account" data-testid="onboard-not-here-link" className="mt-4 inline-flex h-10 items-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white">
          Open Settings › Account
        </Link>
      </div>
    );
  }
  const from = searchParams?.from === "anon" ? "anon" : null;
  return <Onboarding from={from} target={readTarget(searchParams?.step)} />;
}
