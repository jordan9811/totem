"use client";
// Text room stage. Liveness is simulated from a deterministic script driven
// by the controllable clock — the client polls, the server decides which
// scripted messages have "arrived". The AV stage is an explicitly labelled
// stub slot, not an implementation.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Room, RoomHighlight, RoomMessage } from "@/lib/adapters/types";
import { TierBadge } from "./TierBadge";

type Person = { handle: string; name: string; avatarUrl: string; tier: number };

export function RoomStage({
  room: initialRoom,
  initialMessages,
  initialHighlights,
  people,
}: {
  room: Room;
  initialMessages: RoomMessage[];
  initialHighlights: RoomHighlight[];
  people: Record<string, Person>;
}) {
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [messages, setMessages] = useState(initialMessages);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms?roomId=${room.id}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "room unavailable");
      const data = await res.json();
      setRoom(data.room);
      setMessages(data.messages);
      setHighlights(data.highlights);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [room.id]);

  // Poll while the room is open so scripted messages appear on schedule.
  useEffect(() => {
    if (room.status !== "open") return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [room.status, refresh]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, ...body }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "action failed");
        return;
      }
      await refresh();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const highlighted = new Set(highlights.map((h) => h.messageId));

  return (
    <div data-testid="room-stage" data-status={room.status}>
      {/* AV stage — explicitly a stub slot, labelled as such */}
      <div
        data-testid="av-stage-stub"
        className="border-b border-x-border bg-[#f7f9f9] px-4 py-6 text-center"
      >
        <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">Audio stage</p>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">
          Not implemented in this build — text stage only.
        </p>
      </div>

      {/* host controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-x-border px-4 py-3">
        {room.status === "scheduled" && (
          <button
            data-testid="open-room"
            disabled={busy}
            onClick={() => act({ action: "open" })}
            className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
          >
            Open room
          </button>
        )}
        {room.status === "open" && (
          <>
            <button
              data-testid="close-room"
              disabled={busy}
              onClick={() => act({ action: "close" })}
              className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
            >
              End room
            </button>
            <button
              data-testid="advance-room-clock"
              disabled={busy}
              onClick={() => act({ action: "advanceClock", ms: 2000 })}
              className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold hover:bg-x-hover disabled:opacity-50"
            >
              Skip ahead
            </button>
          </>
        )}
        {room.status === "closed" && (
          <span data-testid="room-ended" className="text-[13px] font-bold leading-4 text-x-sec">
            Room ended · {highlights.length} highlights compiled
          </span>
        )}
      </div>

      {error && (
        <p data-testid="room-error" className="border-b border-x-border px-4 py-3 text-[15px] text-x-sec">
          {error}
        </p>
      )}

      {/* message stage */}
      <div data-testid="room-messages">
        {messages.length === 0 && room.status !== "open" && (
          <p className="px-4 py-8 text-center text-[15px] text-x-sec">
            {room.status === "scheduled" ? "Room hasn't started yet." : "No messages."}
          </p>
        )}
        {messages.map((m) => {
          const p = people[m.personaId];
          const isHighlighted = highlighted.has(m.id);
          return (
            <div
              key={m.id}
              data-testid="room-message"
              data-message={m.id}
              className={`flex border-b border-x-border px-4 py-3 ${isHighlighted ? "bg-[#1d9bf00d]" : ""}`}
            >
              <img src={p?.avatarUrl} alt="" className="mr-2 h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center text-[15px] leading-5">
                  <span className="truncate font-bold">{p?.name}</span>
                  <span className="ml-1 truncate text-x-sec">@{p?.handle}</span>
                  <TierBadge tier={p?.tier} />
                  {room.pinnedMessageId === m.id && (
                    <span className="ml-2 text-[11px] font-bold uppercase text-x-blue">Pinned</span>
                  )}
                </p>
                <p className="mt-0.5 text-[15px] leading-5">{m.text}</p>
                {room.status === "open" && (
                  <div className="mt-2 flex gap-3">
                    <button
                      data-testid="mark-highlight"
                      data-message={m.id}
                      disabled={busy || isHighlighted}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await fetch("/api/rooms/highlight", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ roomId: room.id, messageId: m.id }),
                          });
                          if (res.ok) setHighlights((await res.json()).highlights);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="text-[13px] font-bold text-x-blue hover:underline disabled:opacity-50"
                    >
                      {isHighlighted ? "Highlighted" : "Mark highlight"}
                    </button>
                    <button
                      data-testid="pin-message"
                      disabled={busy}
                      onClick={() => act({ action: "pin", messageId: m.id })}
                      className="text-[13px] font-bold text-x-sec hover:underline disabled:opacity-50"
                    >
                      Pin
                    </button>
                    <button
                      data-testid="mute-participant"
                      disabled={busy}
                      onClick={() => act({ action: "mute", personaId: m.personaId, muted: true })}
                      className="text-[13px] font-bold text-x-sec hover:underline disabled:opacity-50"
                    >
                      Mute
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="h-24" />
    </div>
  );
}
