"use client";
import { useState } from "react";
import type { AlgoArtifact } from "@/lib/algo/artifact";
import { useApp } from "@/components/Providers";

export function AlgoActivate({
  cardId,
  artifact,
  refused,
}: {
  cardId: string;
  artifact: AlgoArtifact;
  refused: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // PROD-LIVE (D-CU-0-4): refresh() is router.refresh() (the rig's server re-render, unchanged) PLUS a refetch of
  // every island — on a public deployment the preview and the chrome's mode are the device's answers
  const { refresh } = useApp();

  if (refused)
    return (
      <p data-testid="algo-refused" className="mt-4 text-[15px] font-bold text-[#f4212e]">
        This algorithm was refused and cannot be activated.
      </p>
    );

  if (done)
    return (
      <p data-testid="algo-activated" className="mt-4 text-[15px] font-bold text-x-text">
        {artifact.kind === "filter_pack"
          ? "Imported. Attach it to a mode in Settings → Modes — packs are off until you do."
          : `Active. Your feed now runs ${artifact.name} — switch modes any time.`}
      </p>
    );

  return (
    <div className="mt-4">
      <button
        data-testid="algo-activate"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/algo/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artifact, activate: true }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? `status ${res.status}`);
            setDone(true);
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full bg-x-text px-5 py-2 text-[15px] font-bold text-x-bg disabled:opacity-50"
      >
        {busy
          ? artifact.kind === "filter_pack" ? "Importing…" : "Activating…"
          : artifact.kind === "filter_pack" ? "Import this pack" : "Activate this algorithm"}
      </button>
      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}
    </div>
  );
}
