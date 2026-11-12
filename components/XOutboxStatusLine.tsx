"use client";
// PERSONA LAUNCH P8 — WHERE THE COPY TO @totem ON X IS, under the composer (test data: nothing reaches X).
//
// Mounted after an anonymous post whose X box was ticked. Either the copy was refused at compose (`refusal`: the
// anonymous post still goes, and the line says why the copy did not), or it was queued (`xHash`) and the line follows it
// through GET /api/x/outbox?xHash= — waiting for its proof, queued, sent, waiting for review, approved, posted, not
// approved — in the server's own sentences (lib/x/outbox/status.ts), every one saying it is test data. It reads only what
// THIS device already knows plus the outbox list its last tick read: polling it makes no validator request. It stops
// polling at a final state, and the owner can dismiss it.
import { useEffect, useState } from "react";

interface Line {
  state: string;
  sentence: string;
  final: boolean;
}

export function XOutboxStatusLine({ xHash, refusal, onDismiss }: { xHash: string | null; refusal?: string | null; onDismiss: () => void }) {
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    if (!xHash) return;
    let alive = true;
    let timer: number | null = null;
    const read = () => {
      fetch("/api/x/outbox?xHash=" + encodeURIComponent(xHash), { cache: "no-store" })
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as { item?: { state?: unknown; sentence?: unknown; final?: unknown }; error?: unknown } | null;
          if (!alive) return;
          const it = j?.item;
          if (it && typeof it.state === "string" && typeof it.sentence === "string") setLine({ state: it.state, sentence: it.sentence, final: it.final === true });
          else setLine({ state: "unknown", sentence: "Couldn't read where the copy to @totem on X is (test data).", final: false });
          if (!(it && it.final === true)) timer = window.setTimeout(read, 4000);
        })
        .catch(() => {
          if (!alive) return;
          setLine({ state: "unknown", sentence: "Couldn't read where the copy to @totem on X is (test data).", final: false });
          timer = window.setTimeout(read, 8000);
        });
    };
    read();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [xHash]);
  const shown: Line | null = refusal ? { state: "refused-at-compose", sentence: `The copy to @totem on X wasn't sent: ${refusal} Your anonymous post still goes (test data).`, final: true } : line;
  if (!shown) return null;
  return (
    <p data-testid="x-outbox-status" data-state={shown.state} data-final={shown.final ? "true" : "false"} role="status" className="mt-1.5 px-1 text-[13px] leading-4 text-x-sec">
      <span className="font-bold">@totem on X: </span>
      {shown.sentence}{" "}
      <button type="button" data-testid="x-outbox-status-dismiss" onClick={onDismiss} className="text-x-blue hover:underline">
        dismiss
      </button>
    </p>
  );
}
