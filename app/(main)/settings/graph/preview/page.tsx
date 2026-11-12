import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AdsPreview } from "@/components/settings/AdsPreview";

export const metadata: Metadata = { title: "Ad preview / X" };
export const dynamic = "force-dynamic";

export default function AdsPreviewPage() {
  return (
    <>
      <PageHeader back title="What ads would I see" />
      <AdsPreview />
    </>
  );
}
