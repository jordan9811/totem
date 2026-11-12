import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { folderDetailView } from "@/lib/views/spaces";
import type { FolderDetailView } from "@/lib/views/types";
import { FolderBody } from "@/components/spaces/FolderBody";

export const metadata: Metadata = { title: "Folder / X" };
export const dynamic = "force-dynamic";

export default async function FolderPage({ params }: { params: { folderId: string } }) {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server has no persona to check the folder against, so it must
  // not decide visibility (it used to 404 every folder there). It passes the param on; FolderBody asks the browser
  // device, which applies the SAME fail-closed check (lib/views/spaces.ts folderDetailView) for the visitor.
  let initial: FolderDetailView | null = null;
  if (!isPublicDeployment()) {
    const personaId = activeSeedPersonaId();
    // FAIL CLOSED: a private folder must 404 for a non-owner, and an
    // unreadable permission check must also 404 — never fall through to
    // rendering the contents.
    initial = await folderDetailView(params.folderId, personaId).catch(() => null);
    if (!initial) notFound();
  }

  return <FolderBody folderId={params.folderId} initial={initial} />;
}
