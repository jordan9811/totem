import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GraphBuilder } from "@/components/settings/GraphBuilder";
import Link from "next/link";

export const metadata: Metadata = { title: "Context graph / X" };
export const dynamic = "force-dynamic";

export default function GraphPage() {
  return (
    <>
      <PageHeader back title="Context graph" />
      <div className="flex gap-2 border-b border-x-border px-4 py-3">
        <Link href="/settings/graph/preview" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          What ads would I see
        </Link>
        <Link href="/settings/graph/imports" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          Imports
        </Link>
        <Link href="/settings/backpack" className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-8 hover:bg-x-hover">
          Backpack &amp; score
        </Link>
      </div>
      <GraphBuilder />
    </>
  );
}
