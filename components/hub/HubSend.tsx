"use client";
// SPEC C — CLOSE-FRIEND SENDS from a hub card's menu: send this Farcaster post to everyone in one of your rings. The send
// is the root's (lib/rings/outbound.ts sendToRing: refused while a persona acts and for a post by one of your personas;
// this control is never drawn on such a card). It names the post by its id only and rides the ring's next sealed note;
// the people in the ring see it in their own Following only if their browser already read it there.
import { useEffect, useState } from "react";

interface RingRow {
  id: string;
  label: string;
  members: number;
}

export function HubSendToRing({ fid, hash, onDone }: { fid: number; hash: string; onDone: (said: string) => void }) {
  // the rings are read only once asked for (opening a card's menu reads nothing)
  const [asked, setAsked] = useState(false);
  if (!asked)
    return (
      <button
        type="button"
        data-testid="hub-send-open"
        onClick={(e) => {
          e.stopPropagation();
          setAsked(true);
        }}
        className="flex w-full items-center border-b border-x-border px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover"
      >
        Send to a ring&hellip;
      </button>
    );
  return <RingList fid={fid} hash={hash} onDone={onDone} />;
}

function RingList({ fid, hash, onDone }: { fid: number; hash: string; onDone: (said: string) => void }) {
  const [rings, setRings] = useState<RingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/rings", { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { rings?: Array<{ id: string; label: string; members?: unknown[] | number }>; error?: string } | null;
        if (!alive) return;
        if (!r.ok || !j || !Array.isArray(j.rings)) {
          // never "you have no rings": an unread document is said as that
          setError(j?.error || "Couldn't read your rings just now.");
          return;
        }
        setRings(j.rings.map((x) => ({ id: x.id, label: x.label, members: Array.isArray(x.members) ? x.members.length : Number(x.members ?? 0) || 0 })));
      } catch {
        if (alive) setError("Couldn't read your rings just now.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const send = async (ring: RingRow) => {
    setBusy(ring.id);
    try {
      const r = await fetch("/api/rings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send", ringId: ring.id, target: { fid, hash } }) });
      const j = (await r.json().catch(() => null)) as { error?: string; members?: number } | null;
      if (r.ok) onDone(j && j.members ? `Sent to ${ring.label}. It reaches them with your ring's next note.` : `Saved for ${ring.label}, which has nobody in it yet.`);
      else onDone("Not sent: " + (j?.error || "your device refused it."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="hub-send" className="border-b border-x-border px-4 py-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-[13px] font-bold leading-4 text-x-sec">Send to a ring</p>
      {error ? (
        <p data-testid="hub-send-error" role="alert" className="mt-1 text-[13px] leading-4 text-[#f4212e]">
          {error}
        </p>
      ) : rings === null ? (
        <p className="mt-1 text-[13px] leading-4 text-x-sec">Reading your rings…</p>
      ) : rings.length === 0 ? (
        <p data-testid="hub-send-none" className="mt-1 text-[13px] leading-4 text-x-sec">
          Make a ring in Settings › Rings to send posts to the people in it.
        </p>
      ) : (
        rings.map((ring) => (
          <button
            key={ring.id}
            type="button"
            data-testid="hub-send-ring"
            data-ring={ring.id}
            disabled={busy !== null}
            onClick={() => void send(ring)}
            className="mt-1 block w-full rounded-lg px-2 py-1.5 text-left text-[15px] font-bold hover:bg-x-hover disabled:opacity-50"
          >
            {ring.label}
          </button>
        ))
      )}
    </div>
  );
}
