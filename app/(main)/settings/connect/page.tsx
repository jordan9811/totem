import type { Metadata } from "next";
import Link from "next/link";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ConnectMainAccount } from "@/components/settings/ConnectMainAccount";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Connect your Farcaster account / X" };
export const dynamic = "force-dynamic";

// CONNECT MAIN (lib/fc/connect.ts) — the owner service's page for connecting the owner's own Farcaster account by QR.
// On a public deployment the route behind it refuses every request (the browser preview holds no Neynar key and is no
// one's main account), so the page says so instead of rendering controls that cannot work. Elsewhere the server reads
// the status once while rendering (no loading flash) and the island keeps it current.
export default async function ConnectSettings() {
  if (isPublicDeployment()) {
    return (
      <>
        <SettingsHeader title="Connect your Farcaster account" back="/settings" />
        <div data-testid="connect-unavailable" data-code="public_site" className="mx-4 my-4 rounded-2xl border border-x-border p-4">
          <p className="text-[15px] font-bold leading-5">Not available on the public preview</p>
          <p className="mt-1 text-[15px] leading-5 text-x-sec">
            Connecting your own Farcaster account happens on your private owner service. This public site never holds a Farcaster
            signer for anyone.
          </p>
          <Link href="/settings" className="mt-3 inline-block text-[15px] font-bold text-x-blue hover:underline">
            Back to settings
          </Link>
        </div>
      </>
    );
  }
  let initial = null;
  try {
    const { connectStatus } = await import("@/lib/fc/connect");
    initial = await connectStatus();
  } catch {
    initial = null; // the island asks again, and says what went wrong
  }
  return (
    <>
      <SettingsHeader title="Connect your Farcaster account" back="/settings" />
      <ConnectMainAccount initial={initial} />
    </>
  );
}
