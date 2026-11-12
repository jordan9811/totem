import type { Metadata } from "next";
import Link from "next/link";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { retryAdapter } from "@/lib/adapters/retry";
import { AdapterError } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { PageHeader } from "@/components/PageHeader";
import { CreateIntentForm } from "@/components/market/CreateIntentForm";
import { IntentList, type IntentListData } from "@/components/spaces/IntentList";

export const metadata: Metadata = { title: "Market / X" };
export const dynamic = "force-dynamic";

export default async function MarketPage() {
  // PROD-LIVE (D-CU-0-4): the intents are THIS persona's, and a public deployment's server holds no persona (it used
  // to print "Couldn't load intents ... refusing to mint" to every visitor). It renders the header, the links and the
  // form; IntentList asks the browser device for GET /api/market/intent. On the rig: the same read here, as always.
  let initial: IntentListData | null = null;
  let error: string | null = null;
  if (!isPublicDeployment()) {
    const personaId = activeSeedPersonaId();
    try {
      const intents = await retryAdapter(() => adapters.market.listIntents(personaId));
      initial = {
        intents: intents.map((i) => ({
          id: i.id,
          status: i.status,
          category: i.category,
          description: i.description,
          escrowAmount: i.escrowAmount,
          pitchSlots: i.pitchSlots,
        })),
      };
    } catch (e) {
      error = (e as AdapterError).message;
    }
  }

  return (
    <>
      <PageHeader back title="Market" subtitle="Post an intent, let advertisers bid for it" />
      <div className="flex gap-2 border-b border-x-border px-4 py-3">
        <Link href="/market/advertiser" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          Advertiser console
        </Link>
        <Link href="/market/measurement" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          Measurement
        </Link>
        <Link href="/market/reads" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          Reads
        </Link>
      </div>
      <CreateIntentForm />
      <IntentList initial={initial} serverError={error} />
      <div className="h-24" />
    </>
  );
}
