"use client";
// PROD-LIVE (D-CU-0-4) — the privacy label as a client island.
//
// On a public deployment the server holds no identity, so it cannot compute the verdict (condition 4 runs the
// scope-collision self-test on this root's secret; condition 2 reads this device's prefetch snapshot). The browser
// device answers POST /api/zk {action:"privacyConditions"} in-process, so the verdict is computed where the root
// lives. On the rig a server page may still hand the verdict it computed as `initial`; the label then renders it
// without fetching, byte-for-byte the server label's DOM (PrivacyLabelView).
//
// NEVER FAIL OPEN: while the verdict is unknown nothing claims privacy — a placeholder DEMO band renders, and a
// failed read renders the "could not be computed" band with a Retry that re-reads (never a full page load).
import type { PrivacyVerdict } from "@/lib/zk/privacy";
import { useApiJson } from "@/lib/client/useApiJson";
import { PrivacyLabelUnavailable, PrivacyLabelView } from "./PrivacyLabelView";

export function PrivacyLabelClient({
  initial = null,
  attestation,
}: {
  initial?: PrivacyVerdict | null;
  /** Gate 4: an attestation-GATED surface names the bucket it gates on — the ninth condition is then computed */
  attestation?: { issuer: string; bucket: string };
}) {
  // the query only keys the read (a different bucket is a different verdict); the route reads the body
  const key = attestation ? `?label=${encodeURIComponent(attestation.issuer + "/" + attestation.bucket)}` : "?label=account";
  const { data, error, reload } = useApiJson<PrivacyVerdict>("/api/zk" + key, {
    initial,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestation ? { action: "privacyConditions", attestation } : { action: "privacyConditions" }),
    },
  });
  if (data && Array.isArray(data.conditions)) return <PrivacyLabelView verdict={data} />;
  if (error) return <PrivacyLabelUnavailable error={error} onRetry={reload} />;
  return (
    <div
      data-testid="zk-privacy-label"
      data-state="loading"
      className="border-b border-x-border bg-[#f4212e0d] px-4 py-2 text-[13px] leading-4 text-x-sec"
    >
      Computing the privacy conditions on this device…
    </div>
  );
}
