"use client";
// PROD-LIVE (D-CU-0-4): /algo/[cardId] — THE MANDATORY PREVIEW. The numbers are the identical feed build activation
// will use, for THIS viewer, so on a public deployment only the browser device can compute them: the server passes
// the route param here and this island asks the device for GET /api/algo/view?id= (it used to 404 there, because the
// server's lookup failed). The device's 404 renders this island's own not-found state. On the rig the server computes
// the same view (lib/views/algo.ts) and hands it over as `initial`; the markup below is the page's old markup.
//
// A preview that could not be computed renders an error — never an activate button without its numbers.
import { useApiJson } from "@/lib/client/useApiJson";
import { VIEW_NOT_FOUND, type AlgoDetailView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { AlgoActivate } from "@/components/AlgoActivate";
import { IslandError, IslandLoading, IslandNotFound } from "./IslandStatus";

export function AlgoPreviewBody({ cardId, initial }: { cardId: string; initial: AlgoDetailView | null }) {
  const { data, error, reload } = useApiJson<AlgoDetailView>(`/api/algo/view?id=${encodeURIComponent(cardId)}`, {
    initial,
  });

  if (error === VIEW_NOT_FOUND)
    return (
      <IslandNotFound title="Algorithm preview" testid="algo-not-found" message="This algorithm doesn’t exist." />
    );
  if (error)
    return (
      <>
        <PageHeader back title="Algorithm preview" />
        <IslandError testid="algo-preview-error" lead="Couldn’t compute the preview." error={error} onRetry={reload} />
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader back title="Algorithm preview" />
        <IslandLoading testid="algo-preview-loading" />
      </>
    );

  const { preview } = data;
  const a = data.artifact;

  return (
    <>
      <PageHeader back title={a.name} subtitle={`algorithm · @${a.authorHandle} · v${a.algoVersion}`} />
      <div className="px-4 py-4" data-testid="algo-preview">
        <p className="text-[15px] leading-5 text-x-sec">{a.summary}</p>
        <p className="mt-1 text-[13px] leading-4 text-x-sec">
          by {data.authorName}
          {a.forkedFrom && (
            <span data-testid="algo-provenance">
              {" "}· modified from @{a.forkedFrom.authorHandle}&rsquo;s algo v{a.forkedFrom.algoVersion}
            </span>
          )}
        </p>

        <div className="mt-4 rounded-2xl border border-x-border p-4">
          <h2 className="text-[17px] font-extrabold leading-6 text-x-text">
            Against your current feed
          </h2>
          <p className="mt-2 text-[15px] leading-5 text-x-text" data-testid="preview-hides" data-hides={preview.hides} data-total={preview.total}>
            Hides <span className="font-extrabold">{preview.hides}</span> of{" "}
            <span className="font-extrabold">{preview.total}</span> posts ({preview.pct}%).
          </p>
          {preview.boosts.length > 0 && (
            <p className="mt-1 text-[15px] leading-5 text-x-sec">
              Boosts {preview.boosts.map((b) => "@" + b.handle).join(", ")}.
            </p>
          )}
          {preview.mutedTopics.length > 0 && (
            <p className="mt-1 text-[15px] leading-5 text-x-sec">
              Mutes {preview.mutedTopics.join(", ")} entirely.
            </p>
          )}

          {preview.samples.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
                Posts you would stop seeing
              </p>
              {preview.samples.map((s) => (
                <div key={s.hash} data-testid="preview-sample" className="mt-2 rounded-xl border border-x-border p-3">
                  <p className="text-[13px] font-bold leading-4 text-x-sec">@{s.authorHandle}</p>
                  <p className="mt-1 text-[15px] leading-5 text-x-text">{s.text}</p>
                </div>
              ))}
            </div>
          )}

          {preview.violations.length > 0 && (
            <div data-testid="preview-violations" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-[13px] font-bold text-x-text">
                This artifact tried things imports are not allowed to do:
              </p>
              {preview.violations.map((v, i) => (
                <p key={i} className="mt-1 text-[13px] leading-4 text-x-sec">
                  {v.where} · {v.field} — {v.reason}
                </p>
              ))}
            </div>
          )}
        </div>

        <AlgoActivate cardId={data.cardId} artifact={a} refused={preview.violations.some((v) => /refused/.test(v.reason))} />

        <p className="mt-3 text-[13px] leading-4 text-x-sec">
          Activating never touches who can see your posts, your grants, the
          composer&rsquo;s destination indicator, correction delivery, or ad
          privacy floors — imports cannot reach those, by construction.
        </p>
      </div>
    </>
  );
}
