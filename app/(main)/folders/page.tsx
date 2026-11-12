import type { Metadata } from "next";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { foldersView } from "@/lib/views/spaces";
import type { FoldersView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { FoldersList } from "@/components/spaces/FoldersList";

export const metadata: Metadata = { title: "Folders / X" };
export const dynamic = "force-dynamic";

export default async function FoldersPage() {
  // PROD-LIVE (D-CU-0-4): a production server renders public state only. On a public deployment it holds no
  // identity — whose folders, which ones this persona follows — so it renders the header and FoldersList asks the
  // browser device for GET /api/folders/view. On the rig the server computes the same view exactly as it always
  // did (same reads, same error line) and hands it to the island as its initial data.
  let initial: FoldersView | null = null;
  let error: string | null = null;
  if (!isPublicDeployment()) {
    const personaId = activeSeedPersonaId();
    try {
      initial = await foldersView(personaId);
    } catch (e) {
      error = (e as AdapterError).message;
    }
  }

  return (
    <>
      <PageHeader back title="Folders" />
      <FoldersList initial={initial} serverError={error} />
    </>
  );
}
