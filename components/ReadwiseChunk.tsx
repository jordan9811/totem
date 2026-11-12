"use client";
// POST-DEPLOY Gate 4 — THE DWELL MECHANIC, on the card.
//
// The chunk measures how long it was actually on screen — an IntersectionObserver
// starts a clock when the card is at least half visible and stops it when it is
// not, so scrolling past at speed accumulates almost nothing and reading
// accumulates real time. The accumulated time is flushed to the vault when the
// card leaves the screen or the page is hidden; nothing is sent per tick,
// because a per-tick stream of "this person is still looking" is a surveillance
// feed even when it is encrypted.
//
// The threshold is a function of the chunk LENGTH (words over a reading rate,
// with a floor), computed server-side in lib/readwise/state.ts. A fixed
// threshold would make short chunks always-read and long chunks never-read,
// which measures chunk size rather than reading.
//
// X-ing out BURIES the chunk to a recycle bin. Dismissal that is a void makes
// people stop dismissing, and then the queue never drains.
//
// SPEC C: the same chunk wraps a READING PIECE on the real Following (a long Farcaster post, or one with a link; its id
// "<cast hash>#chunk1"). `initiallyRead` is what the sealed dwell record already says, and a piece put in the bin tells
// the Following island (READWISE_CHANGED_EVENT), which asks the device again: the post shows as a plain post until it is
// restored.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** a piece was put in the bin (or restored): the Following island re-asks the device */
export const READWISE_CHANGED_EVENT = "totem:readwise-changed";

export function ReadwiseChunk({
  chunkId,
  priority,
  initiallyRead = false,
  children,
}: {
  chunkId: string;
  priority?: boolean;
  initiallyRead?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  const since = useRef<number | null>(null);
  const pending = useRef(0);
  const [read, setRead] = useState(initiallyRead);
  const [busy, setBusy] = useState(false);

  const flush = useCallback(async () => {
    if (since.current !== null) {
      pending.current += Date.now() - since.current;
      since.current = null;
    }
    const ms = Math.round(pending.current);
    pending.current = 0;
    if (ms < 250) return;
    try {
      const r = await fetch("/api/readwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dwell", chunkId, ms }),
      });
      const j = await r.json();
      if (r.ok && j.read) setRead(true);
    } catch {
      /* a lost dwell flush is a lost measurement, never a lost chunk */
    }
  }, [chunkId]);

  // a re-render with a newer record (the island re-asked) shows "read" once the record says so
  useEffect(() => {
    if (initiallyRead) setRead(true);
  }, [initiallyRead]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            if (since.current === null) since.current = Date.now();
          } else if (since.current !== null) {
            pending.current += Date.now() - since.current;
            since.current = null;
            void flush();
          }
        }
      },
      { threshold: [0, 0.5, 1] }
    );
    io.observe(el);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  async function dismiss() {
    setBusy(true);
    try {
      await fetch("/api/readwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bury", chunkId }),
      });
      if (typeof window !== "undefined") window.dispatchEvent(new Event(READWISE_CHANGED_EVENT));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} data-testid="readwise-chunk" data-chunk-id={chunkId} data-read={read ? "1" : "0"} data-priority={priority ? "1" : "0"}>
      <div className="flex items-center justify-end gap-2 pr-3 pt-1">
        {priority ? (
          <span data-testid="readwise-priority-flag" className="rounded-full bg-x-pill px-2 py-0.5 text-[11px] font-bold text-x-sec">
            priority folder
          </span>
        ) : null}
        {read ? (
          <span data-testid="readwise-read-flag" className="text-[11px] font-bold text-[#00ba7c]">
            read
          </span>
        ) : null}
        <button
          data-testid="readwise-dismiss"
          aria-label="Put this chunk in the recycle bin"
          disabled={busy}
          onClick={dismiss}
          className="flex h-6 w-6 items-center justify-center rounded-full text-x-sec hover:bg-x-hover disabled:opacity-50"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}
