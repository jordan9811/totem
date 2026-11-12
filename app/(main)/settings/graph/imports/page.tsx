import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GraphImports } from "@/components/settings/GraphImports";

export const metadata: Metadata = { title: "Imports / X" };
export const dynamic = "force-dynamic";

export default function ImportsPage() {
  return (
    <>
      <PageHeader back title="Data imports" />
      <GraphImports />
    </>
  );
}
