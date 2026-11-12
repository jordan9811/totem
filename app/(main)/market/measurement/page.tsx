import type { Metadata } from "next";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { AdapterError } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import type { MeasurementRow } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { MeasurementList, type MeasurementData } from "@/components/spaces/MeasurementList";

export const metadata: Metadata = { title: "Measurement / X" };
export const dynamic = "force-dynamic";

export default async function MeasurementPage() {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server's store cannot hydrate (no device key), so it renders the
  // header and MeasurementList asks the browser device for GET /api/market/measurement — the same aggregates-only
  // shape. On the rig: the same reads here, as always.
  let initial: MeasurementData | null = null;
  let error: string | null = null;
  if (!isPublicDeployment()) {
    try {
      const campaigns = await retryAdapter(() => adapters.market.listCampaigns());
      const rows: MeasurementRow[] = await Promise.all(
        campaigns.map(async (c) => ({
          name: c.name,
          ...(await retryAdapter(() => adapters.market.measurement(c.id))),
        }))
      );
      initial = { aggregates: rows };
    } catch (e) {
      error = (e as AdapterError).message;
    }
  }

  return (
    <>
      <PageHeader back title="Measurement" subtitle="Aggregates only — no user lists" />
      <MeasurementList initial={initial} serverError={error} />
    </>
  );
}
