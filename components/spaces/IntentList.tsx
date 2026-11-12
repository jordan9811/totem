"use client";
// PROD-LIVE (D-CU-0-4): the /market intent list. The intents listed are THIS persona's, and on a public deployment
// only the browser device knows the persona — so the server renders the header, the links and the form, and this
// island asks the device for GET /api/market/intent (which defaults to the device's acting persona). On the rig the
// server reads the same list exactly as it always did and hands it over as `initial`; the markup below is unchanged.
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import type { Intent } from "@/lib/adapters/types";
import { IslandLoading, RetryButton } from "./IslandStatus";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** what a row renders. The rig's server passes exactly this (its page payload carries no buyer persona ids); the
 *  device's GET /api/market/intent answers whole Intents, which satisfy it. */
export type IntentRow = Pick<Intent, "id" | "status" | "category" | "description" | "escrowAmount" | "pitchSlots">;

export interface IntentListData {
  intents: IntentRow[];
}

export function IntentList({ initial, serverError }: { initial: IntentListData | null; serverError: string | null }) {
  const { data, error, reload } = useApiJson<IntentListData>("/api/market/intent", {
    initial,
    enabled: serverError === null,
  });
  // never fail open: an unread list shows its error, and no rows — not "you have no intents"
  const intents = serverError !== null || error ? [] : data?.intents ?? [];

  return (
    <>
      {serverError !== null && (
        <p className="px-4 py-3 text-[15px] text-x-sec">Couldn&rsquo;t load intents. {serverError}</p>
      )}
      {serverError === null && error && (
        <div data-testid="intents-error" className="flex flex-wrap items-center px-4 py-3">
          <p className="text-[15px] text-x-sec">Couldn&rsquo;t load intents. {error}</p>
          <RetryButton onRetry={reload} testid="intents-retry" />
        </div>
      )}
      {serverError === null && !error && !data && <IslandLoading testid="intents-loading" rows={2} />}
      <div data-testid="intent-list">
        {intents.map((i) => (
          <Link
            key={i.id}
            href={`/market/${i.id}`}
            data-testid="intent-row"
            data-intent={i.id}
            data-status={i.status}
            className="block border-b border-x-border px-4 py-3 hover:bg-[#00000006]"
          >
            <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">{i.category}</p>
            <p className="mt-0.5 text-[15px] font-bold leading-5">{i.description}</p>
            <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
              {money(i.escrowAmount)} in escrow · {i.pitchSlots} slots · {i.status}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
