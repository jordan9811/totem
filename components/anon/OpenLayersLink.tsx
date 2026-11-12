"use client";
// PUBLIC GO-LIVE — THE CLICK-THROUGH from /anon into Totem ("Want personas and rings?" — F9: no "your own launched
// accounts" while Launch is parked on the public site: app/api/launch/route.ts refuses it there).
//
// In a browser it is a next/link SOFT navigation to /welcome?from=anon: the same document, so the browser device that
// /anon booted — its root, kept only in this tab until the visitor saves it, and its Sign in with Farcaster link — is the
// very one the onboarding finds (onboard: /welcome?from=anon resumes at the step after Farcaster when the device already
// holds a public self). A full page load would start a fresh, empty identity in a tab that never saved this one, so no
// plain <a href> here, ever. F14: the same document keeps /anon's content security policy for the rest of the session, so
// that policy allows the Totem app's media hosts too (lib/miniapp/manifest.ts ANON_MEDIA_HOSTS) and the origins its
// device calls (anonConnectOrigins); accept-anon-page-prod P8 loads an allowlisted image after the click.
//
// Inside a Farcaster Mini App the storage is not the browser's (a WebView on a phone, a partitioned iframe on the web), so
// the root there cannot come along: it says so plainly, and opens Totem in the browser with the SDK's openUrl, where the
// visitor signs in again.
import Link from "next/link";
import { useState } from "react";
import { miniAppOpenUrl } from "@/lib/miniapp/sdk";

export const OPEN_LAYERS_HREF = "/welcome?from=anon";
/** F9: personas and rings only, until Launch is revived on the public site (then add it back here and in the suites) */
export const OPEN_LAYERS_LEAD = "Want personas and rings?";
export const MINIAPP_STORAGE_NOTE = "Totem opens in your browser, where you sign in again: what you did here stays inside Farcaster.";

export function OpenLayersLink({ inMiniApp, origin }: { inMiniApp: boolean; origin: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <section data-testid="anon-open-layers-card" className="rounded-2xl border border-x-border-dark p-4">
      <p className="text-[15px] font-bold leading-5">{OPEN_LAYERS_LEAD}</p>
      {inMiniApp ? (
        <>
          <p data-testid="anon-open-layers-note" className="mt-1 text-[13px] leading-4 text-x-sec">
            {MINIAPP_STORAGE_NOTE}
          </p>
          <button
            type="button"
            data-testid="anon-open-layers"
            data-mode="miniapp"
            onClick={() =>
              void miniAppOpenUrl(origin + OPEN_LAYERS_HREF).then((ok) => {
                if (!ok) setNote("Totem didn't open. Open " + origin + " in your browser.");
              })
            }
            className="mt-3 h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover"
          >
            Open Totem
          </button>
          {note ? (
            <p role="alert" className="mt-2 text-[13px] text-[#f4212e]">
              {note}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-4 text-x-sec">You stay signed in: Totem picks up where this page left off.</p>
          <Link href={OPEN_LAYERS_HREF} data-testid="anon-open-layers" data-mode="soft" className="mt-3 inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover">
            Open Totem
          </Link>
        </>
      )}
    </section>
  );
}
