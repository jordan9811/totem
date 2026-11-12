import type { Metadata } from "next";
import { AdapterError } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { roomsView } from "@/lib/views/spaces";
import type { RoomsView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { RoomsList } from "@/components/spaces/RoomsList";

export const metadata: Metadata = { title: "Spaces / X" };
export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  // PROD-LIVE (D-CU-0-4): a production server renders public state only — and its store cannot even hydrate without
  // a device key, so on a public deployment it renders the header and RoomsList asks the browser device for
  // GET /api/rooms/view. On the rig: the same view, computed here exactly as it always was.
  let initial: RoomsView | null = null;
  let error: string | null = null;
  if (!isPublicDeployment()) {
    try {
      initial = await roomsView();
    } catch (e) {
      error = (e as AdapterError).message;
    }
  }

  return (
    <>
      <PageHeader back title="Spaces" />
      <RoomsList initial={initial} serverError={error} />
    </>
  );
}
