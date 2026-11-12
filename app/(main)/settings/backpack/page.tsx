import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { BackpackPage } from "@/components/settings/BackpackPage";

export const metadata: Metadata = { title: "Data backpack / X" };
export const dynamic = "force-dynamic";

export default function Backpack() {
  return (
    <>
      <PageHeader back title="Data backpack" />
      <BackpackPage />
    </>
  );
}
