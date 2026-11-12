import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { LaunchPreview, SimulatedNotice } from "@/components/launch/LaunchPreview";
import { isPublicDeployment } from "@/lib/platform/env-contract";

// PERSONA LAUNCH P6 — /launch/<personaId>: preview → confirm → status for one of THIS device's personas (reached from
// "Launch @persona" on its row in Settings › Account & Personas). The page itself reads nothing: the preview, the
// confirm and the status are the device's own route (app/api/launch). On a public deployment launch isn't on yet
// (anonymous proving in the browser is P7) and the page says so instead of offering a flow that cannot run.
export const metadata: Metadata = { title: "Launch a persona / X" };
export const dynamic = "force-dynamic";

export default function LaunchPage({ params }: { params: { personaId: string } }) {
  const personaId = decodeURIComponent(params.personaId);
  return (
    <>
      <SettingsHeader title="Launch a persona" back="/settings/account" />
      {isPublicDeployment() ? (
        <>
          <SimulatedNotice />
          <p data-testid="launch-refusal" className="px-4 py-4 text-[15px] leading-5">
            Launch isn&rsquo;t on this preview yet.
          </p>
        </>
      ) : (
        <LaunchPreview personaId={personaId} />
      )}
    </>
  );
}
