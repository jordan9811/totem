"use client";
// PERSONA LAUNCH P6 (D5) — a launched account's WHOLE revealed history inside Totem, at the ORIGINAL dates, each labelled
// "revealed from @anon". Every row is checked against the (simulated) chain by the route (GET /api/launch?history=1):
// a row whose key is not a registered key of the account is left out, never shown as the account's. This is a display
// inside Totem (C4): on Farcaster the history is the launch cast and its quote-casts, posted at the current time.
import { useEffect, useState } from "react";

interface Item {
  castHash: string;
  text: string;
  at: number;
  label: string;
  checkable: string;
}

export function RevealedHistory({ fid }: { fid: number }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/launch?history=1&fid=${fid}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { items?: Item[]; error?: string } | null;
        if (!alive) return;
        if (r.ok && j?.items) setItems(j.items);
        else setError(j?.error ?? "Couldn't read the revealed posts.");
      } catch {
        if (alive) setError("Couldn't read the revealed posts.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [fid]);
  if (error) return <p className="px-4 py-3 text-[15px] text-x-sec">{error}</p>;
  if (!items || !items.length) return null;
  return (
    <section data-testid="revealed-history" data-fid={fid} className="border-b border-x-border">
      <h2 className="px-4 pt-3 text-[17px] font-bold">Revealed from @anon</h2>
      <p className="px-4 text-[13px] text-x-sec">Posted anonymously first, then revealed at launch. Dates are the original ones. Test data: the launch was simulated.</p>
      <ul>
        {items.map((it) => (
          <li key={it.castHash} data-testid="revealed-history-item" data-at={it.at} data-checkable={it.checkable} className="border-t border-x-border px-4 py-3">
            <p className="text-[13px] text-x-sec">
              {new Date(it.at).toISOString().slice(0, 10)} · <span data-testid="revealed-history-label">{it.label}</span>
            </p>
            <p className="mt-1 text-[15px] leading-5">{it.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
