import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { DeliveryTiersPane } from "@/components/settings/DeliveryTiersPane";

export const metadata: Metadata = { title: "Delivery / X" };
export const dynamic = "force-dynamic";

export default function DeliverySettings() {
  return (
    <>
      <SettingsHeader title="Delivery" back="/settings" />
      <DeliveryTiersPane />
    </>
  );
}
