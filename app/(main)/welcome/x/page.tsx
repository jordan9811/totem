import type { Metadata } from "next";
import Link from "next/link";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { XCallback } from "@/components/x/XCallback";

// SIGN IN WITH X (2026-11-06) — THE CALLBACK PAGE: the redirect URI the owner registers on the X app, exactly
// `<origin>/welcome/x` (lib/x/signin/pkce.ts X_CALLBACK_PATH). Under /welcome on purpose: a top-level /x would shadow the
// profile of anyone whose handle is "x". Inside the app group, so the visitor's browser device boots here as on every app
// page and finishes the sign-in in the tab (components/x/XCallback.tsx). The server renders a shell and reads nothing:
// it never reads the query (X's one-time code is useless without the PKCE verifier, which never leaves the tab), and on a
// public deployment it holds no identity.
//
// On the rig and the owner service (their app pages run no browser device) there is no Sign in with X.
export const metadata: Metadata = { title: "Signing in with X / Totem", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default function XCallbackPage() {
  if (!isPublicDeployment()) {
    return (
      <div data-testid="xsi-not-here" className="px-4 py-10">
        <h1 className="text-[24px] font-extrabold leading-7">Sign in with X</h1>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">Sign in with X is the public site&apos;s: it runs in your browser there.</p>
        <Link href="/settings/account" className="mt-4 inline-flex h-10 items-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white">
          Open Settings › Account
        </Link>
      </div>
    );
  }
  return <XCallback />;
}
