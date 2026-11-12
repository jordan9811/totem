import type { Metadata } from "next";
import Link from "next/link";
import { SettingsHeader } from "@/components/settings/Chrome";
import { DeveloperPane } from "@/components/settings/DeveloperPane";
import { FcSourcesPanel } from "@/components/settings/FcSourcesPanel";
import { registrySnapshot } from "@/lib/adapters/registry";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { allSurfaceStates } from "@/lib/fc/source/switch";
import { relayArmed } from "@/lib/fc/readRelay.server";

export const metadata: Metadata = { title: "Developer / X" };
export const dynamic = "force-dynamic";

export default function DeveloperSettings() {
  // NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42): each Farcaster surface's source and why, read-only, on every shape. The
  // app server computes it from its own env at request time (the relay's armed answer is a boolean, never the key).
  const armed = relayArmed();
  const sources = <FcSourcesPanel states={allSurfaceStates(process.env, armed)} relayArmed={armed} />;
  // PROD-LIVE (D-CU-0-4; D-CU-3-THE-DEV-ROUTE-IS-A-RIG-SURFACE-ENTIRELY): every control on this page drives /api/dev,
  // which refuses unless ZK_DEV_HOOKS is on — on a public deployment each one would be a button that errors. The page
  // says so honestly instead of rendering controls that cannot work (and reads nothing from the server's registry).
  if (isPublicDeployment()) {
    return (
      <>
        <SettingsHeader title="Developer" back="/settings" />
        {sources}
        <div data-testid="developer-unavailable" className="mx-4 my-4 rounded-2xl border border-x-border p-4">
          <p className="text-[15px] font-bold leading-5">Not available on the public preview</p>
          <p className="mt-1 text-[15px] leading-5 text-x-sec">
            The developer tools — the adapter registry, latency injection and the seed reset — drive the test rig&apos;s
            own seeded data. This deployment runs without the rig&apos;s dev hooks, so the route behind them refuses every
            request here by design.
          </p>
          <Link href="/settings" className="mt-3 inline-block text-[15px] font-bold text-x-blue hover:underline">
            Back to settings
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <SettingsHeader title="Developer" back="/settings" />
      {sources}
      <DeveloperPane initialRegistry={registrySnapshot()} />
    </>
  );
}
