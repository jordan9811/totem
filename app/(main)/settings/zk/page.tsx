import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { ZkStatusPane, type ZkSettingsData } from "@/components/zk/ZkStatusPane";
import { toZkStatusView } from "@/components/zk/zkStatusView";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { ProverWhereLine } from "@/components/AnonPostStatus";

export const metadata: Metadata = { title: "ZK privacy layer / X" };
export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): zkStatus() and privacyConditions() derive this root's commitment from the keystore, and a
// public deployment's server has none — this page 500'd there. On a public deployment the server renders the shell
// only and ZkStatusPane reads the visitor's own device (GET /api/zk, answered in the browser). On the rig the server
// computes exactly what it always did — the status, the conditions, the rep binding, then the label's own verdict
// (the server label computed it after the page's reads) — and hands it to the same island as its initial data.
// Only the rendered slice of the status crosses into the island (zkStatusView.ts): the page never showed the rest.
async function rigData(): Promise<ZkSettingsData> {
  const { zkStatus } = await import("@/lib/zk/status");
  const { privacyConditions } = await import("@/lib/zk/privacy");
  const { currentRepImpl } = await import("@/lib/adapters/registry");
  const [s, v] = await Promise.all([zkStatus(), privacyConditions()]);
  const rep = currentRepImpl();
  const label = await privacyConditions(undefined, {});
  return { status: toZkStatusView(s), conditions: v, label, rep };
}

export default async function ZkSettings() {
  const initial = isPublicDeployment() ? null : await rigData();
  return (
    <>
      <SettingsHeader title="ZK privacy layer" back="/settings" />
      <ZkStatusPane initial={initial} />
      {/* PERSONA LAUNCH P7: where proofs are made (this browser's worker on the public site; the server on a rig) and
          how long the last one took — read from the device, public values only */}
      <ProverWhereLine />
      <p className="px-4 py-4 text-[13px] leading-4 text-x-sec">
        Plain-language posture, assumptions and what &ldquo;private&rdquo; means exactly: SECURITY-POSTURE.md in the repository.
      </p>
    </>
  );
}
