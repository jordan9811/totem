// HELP: "How Totem works", at /help. Reached from the left rail (nav-help), the More menu (more-help), the phone
// drawer (drawer-help), the settings index (settings-link-help), the right rail's footer, the landing ("How Totem
// works"). DOCS UNDER APP: the preview banner's "what this means" now goes to the docs' privacy page (/docs/privacy/),
// which every deployment serves; it used to fall back to /help#privacy while no docs URL was set.
//
// WHY IT IS OUTSIDE app/(main). On a public deployment every page in the app group mounts the visitor's browser
// device, and the device MINTS a fresh root at boot when nothing is saved (lib/device/boot.ts; accept-prodlive: "every
// full page load of an UNSAVED visitor mints a new root on the validator"), and the chrome then shows the unsaved-
// identity nudge. A reader who opens Help from the landing, from a new tab (the banner's link opens one), or from a
// search would get an identity they never asked for, a root counted against their address's daily cap, and a save
// nag in front of the explainer. Out here the page is a static shell: no device, no mint, no nag, no identity read.
// What it costs: the app chrome (rail, tab bar) is not drawn on this page; its own header leads back with next/link.
//
// Soft navigation still holds both ways. Every entry point is a next/link, so leaving the app for /help keeps the
// document, and with it the device and an unsaved identity, which live on `window`, not in the app group's React
// tree (the same road /device has always taken). "Open the app" is a next/link back to /home; the group's
// DeviceHostMount then finds the running device (components/device/loadDevice.ts ensureBundle) instead of booting
// another one. A static route beats app/(main)/[handle], so /help is never a profile page again.
//
// Rendered per request (like the landing) so the docs link reflects the deployment's own NEXT_PUBLIC_DOCS_URL override
// (unset: /docs, served by this app), not the build machine's. It reads no validator, no vault, no persona and no device: the deployment's shape and the docs
// URL come from environment variables. On the owner service the middleware gates it like every page; the owner
// cookie is also checked here, as /device does, so a future matcher mistake cannot serve even this page to a stranger.
// OWNER PASSKEYS: a session is live only in the volume's current epoch (and, for a passkey session, while that passkey
// is still registered), so the check reads the gate state from the volume through the explicit source, exactly as
// app/device/page.tsx and the (main) layout do; without a source it fails closed, never open.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HelpPage } from "@/components/help/HelpPage";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused, readOwnerSecret } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { docsUrl } from "@/lib/platform/preview";
import type { SurfaceId } from "@/lib/status/features";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How Totem works",
  description: "What Totem is, what works today on each site, and plain answers to the obvious questions.",
};

export default async function Help() {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  // public site: production without dev hooks. Otherwise the rig shape: the owner service when it is gated by the
  // owner's passphrase, the development rig when it is not (only whether the secret is set is read, never its value)
  const surface: SurfaceId = isPublicDeployment() ? "public" : "owner";
  const rig = surface === "owner" && readOwnerSecret() === null;
  // PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER): the browser prover (/device/prover.js) carries GPL-3.0 code, and its source
  // offer is served beside it (/device/source/, written by scripts/build-device.mjs). One plain line, on every surface that
  // serves the prover; a plain <a>, not next/link — it is a static page, not an app route.
  return (
    <>
      <HelpPage surface={surface} rig={rig} docs={docsUrl()} />
      <p className="mx-auto w-full max-w-[680px] px-4 pb-10 text-[13px] text-[#536471]">
        <a href={GPL_SOURCE_OFFER} data-testid="help-gpl-source" className="underline">
          Source code of the browser prover (GPL-3.0)
        </a>
      </p>
    </>
  );
}

/** where the prover's source offer is served (scripts/lib/gpl-source.mjs OFFER_URL — pinned by scripts/unit-prover.mjs G8) */
const GPL_SOURCE_OFFER = "/device/source/";
