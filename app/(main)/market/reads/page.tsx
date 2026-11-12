import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ReadsInbox } from "@/components/market/ReadsInbox";

export const metadata: Metadata = { title: "Reads / X" };
export const dynamic = "force-dynamic";

export default function ReadsPage() {
  return (
    <>
      <PageHeader back title="Reads" subtitle="Request-priced reads — your attention, your rate card" />
      <ReadsInbox />
    </>
  );
}
