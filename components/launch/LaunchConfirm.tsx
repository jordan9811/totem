"use client";
// PERSONA LAUNCH P6 — THE CONFIRM. The no-undo sentence is on screen BEFORE the box: the owner reads what cannot be
// taken back, then types @handle exactly to unlock the button. The click sends the request to THIS device's own server
// route, which builds and signs the launch request in memory and leaves nothing behind it (lib/launch/confirm.ts): the
// anonymous request is proved at the next tick and sent at a random time. What the account will post by itself (the
// launch cast and the ticked quotes — fix UX-L8) is said here again, and the crowd acknowledgement the preview asked for
// (fix LP-4) rides the request.
import { useState } from "react";

export function LaunchConfirm({
  personaId,
  handle,
  noUndo,
  history,
  quoteOriginals,
  acknowledgeCrowd,
  onConfirmed,
  onBack,
}: {
  personaId: string;
  handle: string;
  noUndo: string;
  history: string;
  quoteOriginals: string[];
  acknowledgeCrowd: boolean;
  onConfirmed: () => void;
  onBack: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const want = "@" + handle;
  const matches = typed.trim().toLowerCase() === want.toLowerCase();
  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", personaId, typed, quoteOriginals, acknowledgeCrowd }) });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (r.status === 202) onConfirmed();
      else setError(j?.error ?? "Couldn't start the launch. Nothing was sent.");
    } catch {
      setError("Couldn't start the launch. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="launch-confirm" className="px-4 py-3">
      <p data-testid="launch-no-undo" className="text-[17px] font-bold leading-6">
        {noUndo}
      </p>
      <p data-testid="launch-confirm-history" className="mt-2 text-[15px] leading-5 text-x-sec">
        {history} {quoteOriginals.length ? `You ticked ${quoteOriginals.length} post${quoteOriginals.length === 1 ? "" : "s"} to quote.` : "You ticked no posts to quote."}
      </p>
      <label className="mt-3 block text-[15px] leading-5">
        Type <span className="font-bold">{want}</span> to confirm
        <input
          data-testid="launch-confirm-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 block w-full rounded-md border border-x-border bg-transparent px-3 py-2 text-[15px]"
        />
      </label>
      {error ? (
        <p data-testid="launch-confirm-error" role="status" className="mt-2 text-[15px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button data-testid="launch-confirm-button" disabled={!matches || busy} onClick={() => void confirm()} className="rounded-full bg-[#f4212e] px-4 py-2 text-[15px] font-bold text-white disabled:opacity-50">
          {busy ? "Launching…" : `Launch ${want}`}
        </button>
        <button onClick={onBack} className="rounded-full border border-x-border px-4 py-2 text-[15px] font-bold">
          Back
        </button>
      </div>
    </div>
  );
}
