"use client";
// PROD-LIVE (D-CU-0-4): the /rooms (Spaces) list. On a public deployment the server's store cannot hydrate (that
// needs a device key the server refuses to mint), so the server renders the header and this island asks the browser
// device for GET /api/rooms/view. On the rig the server computes the same view (lib/views/spaces.ts) and hands it
// over as `initial`; the markup below is the page's old markup, unchanged.
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import type { RoomsView } from "@/lib/views/types";
import { IslandError, IslandLoading } from "./IslandStatus";

const STATUS_LABEL = { scheduled: "Scheduled", open: "Live now", closed: "Ended" } as const;

export function RoomsList({ initial, serverError }: { initial: RoomsView | null; serverError: string | null }) {
  const { data, error, reload } = useApiJson<RoomsView>("/api/rooms/view", {
    initial,
    enabled: serverError === null,
  });

  if (serverError !== null) {
    return <p className="px-4 py-6 text-[15px] text-x-sec">Couldn&rsquo;t load rooms. {serverError}</p>;
  }
  if (error) return <IslandError testid="rooms-error" lead="Couldn’t load rooms." error={error} onRetry={reload} />;
  if (!data) return <IslandLoading testid="rooms-loading" />;

  return (
    <div>
      {data.rooms.map((r) => (
        <Link
          key={r.id}
          href={`/rooms/${r.id}`}
          data-testid="room-row"
          data-room={r.id}
          data-status={r.status}
          className="flex items-start border-b border-x-border px-4 py-3 hover:bg-[#00000006]"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center text-[13px] font-bold leading-4 text-x-sec">
              {r.status === "open" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#f4212e]" />}
              {STATUS_LABEL[r.status]} · {r.topicCluster}
            </p>
            <p className="mt-0.5 text-[17px] font-black leading-6">{r.title}</p>
            <p className="mt-0.5 flex items-center text-[13px] leading-4 text-x-sec">
              <img src={r.hostAvatarUrl} alt="" className="mr-1.5 h-4 w-4 rounded-full object-cover" />
              hosted by @{r.hostHandle}
            </p>
          </div>
        </Link>
      ))}
      <div className="h-24" />
    </div>
  );
}
