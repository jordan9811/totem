"use client";
// PERSONA LAUNCH P6 — WHERE A LAUNCH STANDS, in words (GET /api/launch?personaId=&status=1, polled). Once the account is
// launched the persona's post mode is a REQUIRED choice (D2, preset anon): the picker is right here, in its required
// state, with the sentence that going back to anon after posting directly is weak. After registration a step that has not
// gone through says what EXISTS and offers "Try again" (fix UX-L6); a launch with nothing to show for it offers "Launch
// again" (fix UX-L5); posts the reveal left out are named, with why (fix W2-LAUNCH-REVEAL-200).
import { useEffect, useState } from "react";
import Link from "next/link";
import { PostModePicker, type PostModeOption } from "../PostModePicker";

interface Status {
  stage: string;
  words: string;
  fid: number | null;
  fname: string;
  revealed: number;
  reason: string | null;
  log: Array<{ at: number; stage: string; note: string }>;
  /** PERSONA LAUNCH P6 (fix UX-L6): a step after registration hasn't gone through — "Try again" brings it forward */
  retrying?: boolean;
  /** PERSONA LAUNCH P6 (fix UX-L5): nothing exists for this launch — "Launch again" goes back to the preview */
  canLaunchAgain?: boolean;
  /** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): what the reveal left out */
  leftOut?: { notRelayed: number; refused: number } | null;
}
interface ModeView {
  personaId: string;
  handle: string | null;
  mode: PostModeOption | null;
  options: PostModeOption[];
  settable: boolean;
  launched: boolean;
  choiceRequired: boolean;
}

export function LaunchStatus({ personaId }: { personaId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeView | null>(null);
  const [tick, setTick] = useState(0);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const retry = async () => {
    setRetryNote(null);
    try {
      const r = await fetch("/api/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry", personaId }) });
      const j = (await r.json().catch(() => null)) as { note?: string; error?: string } | null;
      setRetryNote(r.ok ? j?.note ?? "Totem tries again at its next tick." : j?.error ?? "Couldn't ask to try again.");
      setTick((x) => x + 1);
    } catch {
      setRetryNote("Couldn't ask to try again.");
    }
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/launch?personaId=${encodeURIComponent(personaId)}&status=1`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as (Status & { error?: string }) | null;
        if (!alive) return;
        if (r.ok && j) {
          setStatus(j);
          setError(null);
        } else setError(j?.error ?? "Couldn't read the launch's status.");
        if (j && (j.stage === "done" || j.stage === "revealed" || j.stage === "profiled" || j.stage === "history")) {
          const m = await fetch(`/api/personas/post-mode?personaId=${encodeURIComponent(personaId)}`, { cache: "no-store" });
          const mv = (await m.json().catch(() => null)) as ModeView | null;
          if (alive && m.ok && mv) setMode(mv);
        }
      } catch {
        if (alive) setError("Couldn't read the launch's status.");
      }
    })();
    const t = setTimeout(() => setTick((x) => x + 1), 5000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [personaId, tick]);
  if (error && !status) {
    return (
      <p data-testid="launch-status-error" role="status" className="px-4 py-4 text-[15px]">
        {error}
      </p>
    );
  }
  if (!status) return <p className="px-4 py-4 text-[15px] text-x-sec">Reading the launch…</p>;
  return (
    <div data-testid="launch-status" data-stage={status.stage} className="px-4 py-3">
      <p data-testid="launch-status-words" className="text-[17px] font-bold leading-6">
        {status.words}
      </p>
      {status.reason ? (
        <p data-testid="launch-status-reason" className="mt-1 text-[15px] text-x-sec">
          {status.reason}
        </p>
      ) : null}
      {status.fid ? (
        <p className="mt-2 text-[15px]">
          Account: fid {status.fid}
          {status.fname ? ` (@${status.fname})` : ""} on the simulated chain ·{" "}
          <Link href={`/proof/${status.fid}`} data-testid="launch-proof-link" className="text-x-blue hover:underline">
            proof page
          </Link>
        </p>
      ) : null}
      {status.revealed ? <p className="mt-1 text-[15px]">{status.revealed} anonymous post{status.revealed === 1 ? "" : "s"} revealed.</p> : null}
      {status.leftOut && (status.leftOut.notRelayed || status.leftOut.refused) ? (
        <p data-testid="launch-status-left-out" className="mt-1 text-[15px] text-x-sec">
          Not revealed:{" "}
          {[
            status.leftOut.notRelayed ? `${status.leftOut.notRelayed} post${status.leftOut.notRelayed === 1 ? " that was" : "s that were"} never relayed by @anon` : "",
            status.leftOut.refused ? `${status.leftOut.refused} post${status.leftOut.refused === 1 ? " that was" : "s that were"} refused and never posted` : "",
          ]
            .filter(Boolean)
            .join("; ")}
          . They stay private.
        </p>
      ) : null}
      {status.retrying ? (
        <div className="mt-2">
          <button data-testid="launch-try-again" onClick={() => void retry()} className="rounded-full border border-x-border px-4 py-2 text-[15px] font-bold">
            Try again
          </button>
          {retryNote ? (
            <p data-testid="launch-try-again-note" role="status" className="mt-1 text-[13px] text-x-sec">
              {retryNote}
            </p>
          ) : null}
        </div>
      ) : null}
      {status.canLaunchAgain ? (
        <p className="mt-2 text-[15px]">
          <a href={`/launch/${encodeURIComponent(personaId)}`} data-testid="launch-again" className="text-x-blue hover:underline">
            Launch again
          </a>
        </p>
      ) : null}
      {mode && mode.mode && mode.launched ? (
        <div className="mt-3">
          <PostModePicker personaId={mode.personaId} handle={mode.handle} mode={mode.mode} options={mode.options} settable={mode.settable} choiceRequired={mode.choiceRequired} launched onChanged={() => setTick((x) => x + 1)} />
        </div>
      ) : null}
    </div>
  );
}
