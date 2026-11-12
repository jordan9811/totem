import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { IntentAuction } from "@/components/market/IntentAuction";

export const metadata: Metadata = { title: "Auction / X" };
export const dynamic = "force-dynamic";

export default function AuctionPage({ params }: { params: { intentId: string } }) {
  return (
    <>
      <PageHeader back title="Intent auction" />
      <IntentAuction intentId={params.intentId} />
    </>
  );
}
