import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AdvertiserConsole } from "@/components/market/AdvertiserConsole";

export const metadata: Metadata = { title: "Advertiser console / X" };
export const dynamic = "force-dynamic";

export default function AdvertiserPage() {
  return (
    <>
      <PageHeader back title="Advertiser console" subtitle="Audience built with the rules engine" />
      <AdvertiserConsole />
    </>
  );
}
