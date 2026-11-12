"use client";
// PUBLIC GO-LIVE (the relay track) — REPORT on an anonymous post, in Totem (components/CastCard.tsx, every @anon card) and
// on the native /anon page (components/anon/AnonFeed.tsx). A small "Report" button opens a fixed list of reasons; picking
// one sends it through POST /api/anon/report (answered by this browser's device) to the validator, which keeps the post,
// the reason and the hour — never who reported it. The moderators see it in their takedown queue (Settings › Moderation).
// Every answer is a plain sentence; a report that could not be sent says so and can be tried again.
import { useState } from "react";

/** DELIBERATE DUPLICATE of lib/zk/anon/moderation.ts REPORT_REASONS / REPORT_REASON_LABELS (that module is server-only in Next's
 *  terms; scripts/unit-anon-relay.mjs holds the ids and labels here equal to it, and to validator/anonpublic.js) */
const REASONS: Array<{ id: string; label: string }> = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "hate", label: "Hate or slurs" },
  { id: "doxxing", label: "Shares someone's private details" },
  { id: "violence", label: "Threats or violence" },
  { id: "illegal", label: "Illegal content" },
  { id: "scam", label: "A scam or fraud" },
  { id: "other", label: "Something else" },
];

export function AnonReportButton({ castHash, universe, className = "" }: { castHash: string; universe?: "fixture" | "live" | string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  if (!/^[0-9a-f]{64}$/.test(castHash || "")) return null;
  const send = async (reason: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/anon/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ castHash, reason, ...(universe === "live" || universe === "fixture" ? { universe } : {}) }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; sentence?: string; error?: string } | null;
      if (r.ok && j?.ok) {
        setSaid({ ok: true, text: j.sentence ?? "Thanks. Your report reached the moderators." });
        setOpen(false);
      } else setSaid({ ok: false, text: j?.error ?? "Couldn't send the report just now. Try again in a moment." });
    } catch {
      setSaid({ ok: false, text: "Couldn't send the report just now. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={"mt-1 " + className} data-testid="anon-report" onClick={(e) => e.stopPropagation()}>
      {said?.ok ? (
        <p data-testid="anon-report-done" className="text-[12px] leading-4 text-x-sec">{said.text}</p>
      ) : (
        <>
          <button
            type="button"
            data-testid="anon-report-open"
            aria-expanded={open}
            disabled={busy}
            onClick={() => {
              setOpen((v) => !v);
              setSaid(null);
            }}
            className="text-[12px] font-bold leading-4 text-x-sec hover:underline disabled:opacity-50"
          >
            Report
          </button>
          {open ? (
            <div data-testid="anon-report-reasons" role="group" aria-label="Why are you reporting this post?" className="mt-1 flex flex-wrap gap-1">
              <span className="w-full text-[12px] leading-4 text-x-sec">Why? Your report carries no name or account, but it reaches Totem from your internet address.</span>
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid="anon-report-reason"
                  data-reason={r.id}
                  disabled={busy}
                  onClick={() => void send(r.id)}
                  className="h-7 rounded-full border border-[#cfd9de] px-2 text-[12px] font-bold hover:bg-x-hover disabled:opacity-50"
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}
          {said && !said.ok ? (
            <p data-testid="anon-report-error" className="mt-1 text-[12px] leading-4 text-x-sec">
              {said.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
