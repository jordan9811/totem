"use client";
// PROD-LIVE (D-CU-0-4): /rooms/[roomId]. On a public deployment the server cannot read the room (its store cannot
// hydrate without a device key — it used to 404 every room there), so it passes the route param here and this island
// asks the browser device for GET /api/rooms/view?roomId=, then hands RoomStage exactly the initial data the server
// page used to. On the rig the server computes the same view (lib/views/spaces.ts roomDetailView) and hands it over
// as `initial`.
import { useApiJson } from "@/lib/client/useApiJson";
import { VIEW_NOT_FOUND, type RoomDetailView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { RoomStage } from "@/components/RoomStage";
import { IslandError, IslandLoading, IslandNotFound } from "./IslandStatus";

export function RoomBody({ roomId, initial }: { roomId: string; initial: RoomDetailView | null }) {
  const { data, error, reload } = useApiJson<RoomDetailView>(`/api/rooms/view?roomId=${encodeURIComponent(roomId)}`, {
    initial,
  });

  if (error === VIEW_NOT_FOUND)
    return <IslandNotFound title="Space" testid="room-not-found" message="This room doesn’t exist." />;
  if (error)
    return (
      <>
        <PageHeader back title="Space" />
        <IslandError testid="room-load-error" lead="Couldn’t load this room." error={error} onRetry={reload} />
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader back title="Space" />
        <IslandLoading testid="room-loading" />
      </>
    );

  return (
    <>
      <PageHeader back title={data.room.title} subtitle={`hosted by @${data.hostHandle}`} />
      <RoomStage
        room={data.room}
        initialMessages={data.messages}
        initialHighlights={data.highlights}
        people={data.people}
      />
    </>
  );
}
