"use client";
// The 3-strike auto-mute toggle. Per-user, default OFF — automated
// moderation on your behalf is something you turn on, never something that
// happens to you.
import { useCallback, useEffect, useState } from "react";

export function StrikeToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // PROD-LIVE (D-CU-0-4, never fail open): an unread setting used to render as OFF — a claim about automated
  // moderation the page had not read. It now stays unknown (the switch disabled) and says so, with a re-read.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetch("/api/strike", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.error) throw new Error((j && j.error) || `HTTP ${r.status}`);
        setEnabled(!!j.setting?.enabled);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "request failed"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (busy || enabled === null) return;
    setBusy(true);
    const next = !enabled;
    try {
      const r = await fetch("/api/strike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setting", enabled: next }),
      });
      if (r.ok) setEnabled(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center border-b border-x-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-5 text-x-text">Three-strike auto-mute</p>
        <p className="text-[13px] leading-4 text-x-sec">
          After you strike an account three times, mute it automatically. Every
          strike keeps its receipt on their profile, and turning this off
          un-mutes everyone — receipts intact.
        </p>
        {loadError ? (
          <p data-testid="strike-load-error" className="mt-1 text-[13px] leading-4 text-[#f4212e]">
            Couldn&rsquo;t read this setting. {loadError}{" "}
            <button onClick={load} className="font-bold text-x-blue hover:underline">
              Retry
            </button>
          </p>
        ) : null}
      </div>
      <button
        data-testid="strike-toggle"
        data-enabled={enabled ? "true" : "false"}
        disabled={busy || enabled === null}
        onClick={toggle}
        className={`ml-3 h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${
          enabled ? "bg-x-green" : "bg-[#cfd9de]"
        }`}
      >
        <span
          className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
