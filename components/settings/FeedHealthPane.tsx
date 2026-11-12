"use client";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import type { NoteReinjection, ReadwiseSchedule, SaturationEntry } from "@/lib/adapters/types";
import { ErrorNote, LoadingRows, Row, SettingsGroup, Toggle } from "./Chrome";

interface Payload {
  schedules: ReadwiseSchedule[];
  saturated: SaturationEntry[];
  permission: boolean;
  inbox: { id: string; fromPersonaId: string; postHash: string }[];
  reinjections: NoteReinjection[];
}

export function FeedHealthPane() {
  // PROD-LIVE (D-CU-0-4): refreshApp() is router.refresh() plus a refetch of every island and the device-read chrome
  // (on a public deployment the chrome is the browser device's answer, which a server re-render alone would not re-read)
  const { refresh: refreshApp } = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/feed-health");
      if (!res.ok) throw new Error((await res.json()).error ?? "could not load feed health");
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
      setData({ schedules: [], saturated: [], permission: true, inbox: [], reinjections: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error((await res.json()).error ?? "request failed");
      await load();
      refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (data === null) return <LoadingRows count={4} />;

  return (
    <>
      <ErrorNote error={error} onRetry={load} />

      <SettingsGroup
        title="Readwise in timeline"
        note="Bookmarking a long-form post breaks it into chunks and schedules them back into your timeline in order. How many arrive per refresh, how long a chunk is, which folders come first and what you have dismissed all live in Settings -> Readwise."
      >
        {data.schedules.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-x-sec">
            No active schedules. Bookmark a long post to start one.
          </p>
        ) : (
          data.schedules.map((s) => (
            <Row
              key={s.postHash}
              testid={`readwise-${s.postHash}`}
              label={`${s.postHash}`}
              sub={`chunk ${s.nextChunkIndex} of ${s.chunks.length} surfaced`}
              right={
                <button
                  onClick={() =>
                    act("advance", () =>
                      fetch("/api/feed-health/readwise", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ postHash: s.postHash }),
                      })
                    )
                  }
                  disabled={busy !== null || s.nextChunkIndex >= s.chunks.length}
                  className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50"
                >
                  Next chunk
                </button>
              }
            />
          ))
        )}
        <Row
          testid="readwise-fast-forward"
          label="Fast-forward all schedules"
          sub="Dev control: advance every schedule by one chunk"
          onClick={() =>
            act("ff", () =>
              fetch("/api/feed-health/readwise", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ all: true }),
              })
            )
          }
          right={<span className="text-[15px] font-bold text-x-blue">{busy === "ff" ? "…" : "Advance"}</span>}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Send to timeline"
        note="When someone you follow sends you a post, it renders inline in your timeline instead of a DM."
      >
        <Row
          testid="send-permission-row"
          label="Accept posts sent to my timeline"
          sub={data.permission ? "On — sent posts appear inline" : "Off — sends are blocked before they reach you"}
          right={
            <Toggle
              testid="send-permission-toggle"
              on={data.permission}
              busy={busy === "permission"}
              onChange={(next) =>
                act("permission", () =>
                  fetch("/api/feed-health/permission", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allow: next }),
                  })
                )
              }
            />
          }
        />
        <Row label="In your timeline now" sub={`${data.inbox.length} sent post${data.inbox.length === 1 ? "" : "s"}`} />
      </SettingsGroup>

      <SettingsGroup
        title="Topic saturation"
        note="Marked-as-caught-up stories stop resurfacing unless there's a material update."
      >
        {data.saturated.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-x-sec">Nothing marked caught up.</p>
        ) : (
          data.saturated.map((entry) => (
            <Row
              key={entry.storyId + entry.modeId}
              testid={`saturation-${entry.storyId}`}
              label={entry.storyId}
              sub={entry.modeId ? "this mode only" : "all modes"}
              right={
                <button
                  onClick={() =>
                    act("clear", () =>
                      fetch("/api/feed-health/saturation", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ storyId: entry.storyId, clear: true }),
                      })
                    )
                  }
                  disabled={busy !== null}
                  className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50"
                >
                  Unmute
                </button>
              }
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Community note corrections"
        note="A note reinjects a post you engaged with only if its author is tier 3+ and it has 2+ endorsements."
      >
        {data.reinjections.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-x-sec">No notes on posts you&rsquo;ve engaged with.</p>
        ) : (
          data.reinjections.map((r) => (
            <Row
              key={r.noteId}
              testid={`reinjection-${r.noteId}`}
              label={r.qualifies ? "Reinjected into your timeline" : "Held back"}
              sub={r.reason}
              right={
                <span
                  className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${
                    r.qualifies ? "bg-[#00ba7c1a] text-x-green" : "bg-x-pill text-x-sec"
                  }`}
                >
                  {r.qualifies ? "passes gate" : "fails gate"}
                </span>
              }
            />
          ))
        )}
      </SettingsGroup>
      <div className="h-24" />
    </>
  );
}
