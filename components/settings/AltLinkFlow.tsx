"use client";
// CALL OPTION A — X alt linking. The disclaimer modal has NO close button
// and NO backdrop dismissal on purpose: "non-dismissable before first use"
// is a product requirement, not a styling choice. Acknowledging it is the
// only way through, and it only ever appears again if it hasn't been
// acknowledged yet for the active persona.
import { useCallback, useEffect, useState } from "react";

interface Status {
  personaId: string;
  handle: string;
  name: string;
  primaryHandle: string;
  altHandles: string[];
}
interface Attempt {
  id: string;
  handleA: string;
  handleB: string;
  targetPostId: string;
  delayMs: number;
  likedAt: [number, number];
  status: "scheduled" | "completed";
}

export function AltLinkFlow() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dailyCap, setDailyCap] = useState(0);
  const [dailyRemaining, setDailyRemaining] = useState(0);
  const [acked, setAcked] = useState(true); // assume acked until the fetch says otherwise — avoids a modal flash
  const [recentAttempts, setRecentAttempts] = useState<Attempt[]>([]);

  const [newAltHandle, setNewAltHandle] = useState("");
  const [altHandle, setAltHandle] = useState("");
  const [targetPostId, setTargetPostId] = useState("");
  const [audienceMember, setAudienceMember] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);

  const refresh = useCallback(async () => {
    const j = await fetch("/api/x/altlink", { cache: "no-store" }).then((r) => r.json());
    setStatus(j.status ?? null);
    setDailyCap(j.dailyCap ?? 0);
    setDailyRemaining(j.dailyRemaining ?? 0);
    setAcked(!!j.disclaimerAcked);
    setRecentAttempts(j.recentAttempts ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const acknowledge = async () => {
    await fetch("/api/x/altlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ackDisclaimer" }),
    });
    refresh();
  };

  const linkAlt = async () => {
    if (!newAltHandle.trim()) return;
    const res = await fetch("/api/x/altlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "linkAlt", handle: newAltHandle.trim() }),
    });
    const j = await res.json();
    if (!res.ok) {
      setError(j.error ?? "could not link that alt handle");
      return;
    }
    setNewAltHandle("");
    setError(null);
    refresh();
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/x/altlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", altHandle, targetPostId, audienceMember }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "could not run alt-link");
        return;
      }
      setResult(j.attempt);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="px-4 py-4 text-[14px] text-x-sec" data-testid="alt-link-flow">
        Link an X account first (Settings → Import from X) to use this feature.
      </div>
    );
  }

  return (
    <div data-testid="alt-link-flow" className="px-4 py-4">
      {!acked && (
        <div
          data-testid="alt-link-disclaimer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-w-md rounded-2xl bg-white p-5">
            <h3 className="text-[17px] font-extrabold">Before you use this</h3>
            <p className="mt-2 text-[14px] leading-5 text-x-sec">
              This is <strong>social proof, not cryptographic proof</strong>. Anyone can coordinate
              two likes from two accounts — a synchronized like proves nothing on its own. The real
              disclosure this feature makes is the in-app grant it issues; the like on X is a soft,
              deniable secondary signal only.
            </p>
            <p className="mt-2 text-[14px] leading-5 text-x-sec">
              Coordinating engagement across accounts is against most platforms&rsquo; terms of
              service and could put those accounts at risk. Use this at your own risk. This app
              never runs it as a batch, and hard-limits it to a few times per day per account.
            </p>
            <button
              data-testid="alt-link-disclaimer-ack"
              onClick={acknowledge}
              className="mt-4 h-10 w-full rounded-full bg-x-black-btn text-[14px] font-bold text-white"
            >
              I understand the risk — continue
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 rounded-2xl border border-[#f4212e] bg-[#fdeeee] p-3 text-[13px] leading-4">
        <strong>Experimental.</strong> Social proof, not cryptographic proof — see the disclaimer
        above. Fixture mode only; this never contacts real X.
      </div>

      <p className="text-[14px]" data-testid="alt-link-you">
        You: @{status.primaryHandle} ({status.handle}) — {dailyRemaining} of {dailyCap} runs left today
      </p>

      <div className="mt-3 flex gap-2">
        <input
          data-testid="alt-link-new-handle"
          value={newAltHandle}
          onChange={(e) => setNewAltHandle(e.target.value)}
          placeholder="Link an alt X handle you also control"
          className="h-9 flex-1 rounded-md border border-[#cfd9de] px-2 text-[14px]"
        />
        <button
          data-testid="alt-link-add-handle"
          onClick={linkAlt}
          disabled={!newAltHandle.trim()}
          className="h-9 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold disabled:opacity-50"
        >
          Link
        </button>
      </div>

      {status.altHandles.length > 0 && (
        <div className="mt-4 space-y-2">
          <select
            data-testid="alt-link-alt-handle"
            value={altHandle}
            onChange={(e) => setAltHandle(e.target.value)}
            className="h-9 w-full rounded-md border border-[#cfd9de] px-2 text-[14px]"
          >
            <option value="">Which linked alt handle?</option>
            {status.altHandles.map((h) => (
              <option key={h} value={h}>
                @{h}
              </option>
            ))}
          </select>
          <input
            data-testid="alt-link-target"
            value={targetPostId}
            onChange={(e) => setTargetPostId(e.target.value)}
            placeholder="Target X post id"
            className="h-9 w-full rounded-md border border-[#cfd9de] px-2 text-[14px]"
          />
          <input
            data-testid="alt-link-audience"
            value={audienceMember}
            onChange={(e) => setAudienceMember(e.target.value)}
            placeholder="Who are you showing this to? (handle)"
            className="h-9 w-full rounded-md border border-[#cfd9de] px-2 text-[14px]"
          />
          <button
            data-testid="alt-link-run"
            disabled={busy || !altHandle || !targetPostId || !audienceMember}
            onClick={run}
            className="h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
          >
            Link accounts
          </button>
        </div>
      )}

      {error && (
        <p data-testid="alt-link-error" className="mt-2 text-[13px] text-[#f4212e]">
          {error}
        </p>
      )}
      {result && (
        <p data-testid="alt-link-result" data-delay={result.delayMs} className="mt-2 text-[13px] font-bold text-[#00ba7c]">
          Grant issued. Likes scheduled {result.delayMs}ms apart from @{result.handleA} and @{result.handleB}.
        </p>
      )}

      {recentAttempts.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-x-sec">Today&rsquo;s runs</p>
          {recentAttempts.map((a) => (
            <p key={a.id} data-testid="alt-link-attempt" data-status={a.status} className="mt-1 text-[13px] text-x-sec">
              @{a.handleA} ↔ @{a.handleB} on {a.targetPostId} · {a.delayMs}ms delay · {a.status}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
