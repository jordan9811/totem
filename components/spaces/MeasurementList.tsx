"use client";
// PROD-LIVE (D-CU-0-4): /market/measurement. Aggregates only — but on a public deployment the server still cannot
// read them: its store hydrates through signed reads, and it holds no device key to sign with (it used to print
// "Couldn't load measurement ... refusing to mint"). So the server renders the header and this island asks the
// browser device for GET /api/market/measurement. On the rig the server reads the same rows as always and hands them
// over as `initial`; the markup below is unchanged.
import { useApiJson } from "@/lib/client/useApiJson";
import type { MeasurementRow } from "@/lib/views/types";
import { IslandError, IslandLoading } from "./IslandStatus";

export interface MeasurementData {
  aggregates: MeasurementRow[];
}

export function MeasurementList({ initial, serverError }: { initial: MeasurementData | null; serverError: string | null }) {
  const { data, error, reload } = useApiJson<MeasurementData>("/api/market/measurement", {
    initial,
    enabled: serverError === null,
  });

  if (serverError !== null) {
    return <p className="px-4 py-6 text-[15px] text-x-sec">Couldn&rsquo;t load measurement. {serverError}</p>;
  }
  if (error) return <IslandError testid="measurement-error" lead="Couldn’t load measurement." error={error} onRetry={reload} />;
  if (!data) return <IslandLoading testid="measurement-loading" rows={2} />;

  const rows = data.aggregates;
  return (
    <div data-testid="measurement" className="px-4 py-4">
      <p className="mb-4 rounded-2xl border border-x-border bg-[#f7f9f9] p-3 text-[13px] leading-4 text-x-sec">
        Counts carry differential-privacy noise of ±{rows[0]?.noiseBound ?? 5}. There is no way
        to see who is in an audience — this view has never had access to that.
      </p>
      {rows.map((r) => (
        <div
          key={r.campaignId}
          data-testid="measurement-row"
          data-campaign={r.campaignId}
          className="mb-3 rounded-2xl border border-x-border p-4"
        >
          <p className="text-[15px] font-bold leading-5">{r.name}</p>
          <div className="mt-2 flex gap-6">
            <div>
              <p className="text-[13px] leading-4 text-x-sec">Impressions</p>
              <p className="text-[17px] font-black leading-6">
                {r.impressions.toLocaleString()}
                <span className="ml-1 text-[13px] font-normal text-x-sec">±{r.noiseBound}</span>
              </p>
            </div>
            <div>
              <p className="text-[13px] leading-4 text-x-sec">Conversions</p>
              <p className="text-[17px] font-black leading-6">
                {r.conversions.toLocaleString()}
                <span className="ml-1 text-[13px] font-normal text-x-sec">±{r.noiseBound}</span>
              </p>
            </div>
          </div>
        </div>
      ))}
      <div className="h-24" />
    </div>
  );
}
