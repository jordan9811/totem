"use client";
// /settings/earnings — what your graph earned, by category, and the settlement history.
//
// PROD-LIVE (D-CU-0-4): the page read adapters.settle.* for activeSeedPersonaId() on the server. On a public
// deployment the server has no identity (the adapters' first read reaches for a device key it refuses to mint, and
// its fallback persona is the rig's fixture), so the page printed "Couldn't load earnings … refusing to mint".
//   • on the RIG the server reads exactly as before and hands the result — or its error — over as `initial`; the DOM
//     below is the page's former DOM, and nothing is fetched;
//   • on a PUBLIC deployment the island reads GET /api/earnings, which the browser device answers for its own
//     acting persona.
// NEVER FAIL OPEN: a failed read is the same "Couldn't load earnings" line, with a Retry (a re-read — a full page
// load would discard an unsaved identity), never a $0.00 presented as the truth.
import type { SettlementEvent } from "@/lib/adapters/types";
import { useApiJson } from "@/lib/client/useApiJson";
import { relativeTime } from "@/lib/format";
import { LoadingRows } from "./Chrome";

/** the fields a settlement row renders — on the rig only these cross into the island (the page never showed more) */
export type SettlementRow = Pick<SettlementEvent, "id" | "kind" | "note" | "amount" | "createdAt">;
/** the shape GET /api/earnings answers (its events carry more fields; the rows read these), and the rig page read */
export interface EarningsData {
  events: SettlementRow[];
  byCategory: { category: string; total: number }[];
  total: number;
}
/** the rig's server read: its data, or the error it caught (the page rendered either, never both) */
export interface EarningsInitial {
  data: EarningsData | null;
  error: string | null;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function EarningsPane({ initial }: { initial: EarningsInitial | null }) {
  const server = initial !== null;
  const remote = useApiJson<EarningsData>(server ? null : "/api/earnings");
  const data = server ? initial.data : remote.data;
  const error = server ? initial.error : remote.error;

  if (!server && !data && !error) return <LoadingRows count={4} />;

  if (error || !data) {
    return (
      <>
        <p data-testid="earnings-error" className="px-4 py-6 text-[15px] text-x-sec">
          Couldn&rsquo;t load earnings. {error ?? "no data"}
        </p>
        {!server ? (
          <button
            onClick={remote.reload}
            data-testid="earnings-retry"
            className="mx-4 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white"
          >
            Retry
          </button>
        ) : null}
      </>
    );
  }

  const { events, byCategory, total } = data;
  const max = Math.max(1, ...byCategory.map((c) => c.total));

  return (
    <div data-testid="earnings">
      <div className="border-b border-x-border px-4 py-5">
        <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
          Total earned by your graph
        </p>
        <p data-testid="earnings-total" data-cents={total} className="mt-1 text-[31px] font-black leading-9">
          {money(total)}
        </p>
      </div>

      <section className="border-b border-x-border px-4 py-4">
        <h3 className="text-[17px] font-black leading-6">By category</h3>
        <div className="mt-3">
          {byCategory.map((c) => (
            <div key={c.category} data-testid="earnings-category" data-category={c.category} data-cents={c.total} className="mb-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-bold capitalize leading-5">{c.category}</span>
                <span className="text-[15px] leading-5 text-x-sec">{money(c.total)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-x-border">
                <div className="h-full rounded-full bg-x-blue" style={{ width: `${(c.total / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 py-4">
        <h3 className="text-[17px] font-black leading-6">Settlement history</h3>
        <div className="mt-2">
          {events.map((e) => (
            <div
              key={e.id}
              data-testid="settlement-event"
              data-kind={e.kind}
              className="flex items-start justify-between border-b border-x-border py-3"
            >
              <div className="min-w-0 pr-4">
                <p className="text-[15px] leading-5">{e.note}</p>
                {/* PROD-LIVE: relative time is "now"-dependent; this island is server-rendered on the rig and hydrated
                    in the browser a moment later, so the server's text is kept rather than re-computed at hydration */}
                <p className="mt-0.5 text-[13px] leading-4 text-x-sec" suppressHydrationWarning>
                  {e.kind.replace(/_/g, " ")} · {relativeTime(e.createdAt)}
                </p>
              </div>
              <span className="shrink-0 text-[15px] font-bold leading-5">{money(e.amount)}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="h-24" />
    </div>
  );
}
