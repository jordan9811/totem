import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AltLinkFlow } from "@/components/settings/AltLinkFlow";

export const metadata: Metadata = { title: "Experimental / X" };
export const dynamic = "force-dynamic";

export default function ExperimentalSettings() {
  return (
    <>
      <PageHeader back title="Experimental" />
      <div className="border-b border-x-border bg-[#fff8e6] px-4 py-2.5 text-[13px] leading-4">
        Features here are prototypes: riskier, less polished, and more likely to change or
        disappear than the rest of the app.
      </div>
      <div className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-extrabold">Link my X alt</h2>
        <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
          Prove you control two X accounts to someone you&rsquo;re showing this to.
        </p>
      </div>
      <AltLinkFlow />
    </>
  );
}
