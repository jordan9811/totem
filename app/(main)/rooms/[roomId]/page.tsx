import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { roomDetailView } from "@/lib/views/spaces";
import type { RoomDetailView } from "@/lib/views/types";
import { RoomBody } from "@/components/spaces/RoomBody";

export const metadata: Metadata = { title: "Space / X" };
export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: { roomId: string } }) {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server's store cannot hydrate (no device key), so it must not
  // look the room up — it used to 404 every room there. It passes the param on; RoomBody asks the browser device.
  // On the rig: the same lookup and the same lenient message/highlight reads as always, then the same RoomStage.
  let initial: RoomDetailView | null = null;
  if (!isPublicDeployment()) {
    initial = await roomDetailView(params.roomId).catch(() => null);
    if (!initial) notFound();
  }

  return <RoomBody roomId={params.roomId} initial={initial} />;
}
