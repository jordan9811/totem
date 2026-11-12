"use client";
// MEGA PASS 2 Gate 5 — the @totem DM hook, in settings: poll the inbox on
// demand (every read through the spend ledger), see what landed in your
// "From X DM" folder and readwise queue, see the (recorded) replies sent to
// unlinked senders — and set, per mode, how often a DM-sourced item drips
// into your feed and how it appears.
import { useCallback, useEffect, useState } from "react";

interface Info {
  mode: "fixture" | "live";
  cursor: number;
  linkedHandle: string | null;
  replies: { dmId: string; senderHash: string; kind: string; text: string; at: number; sent: false }[];
  folder: { id: string; name: string; count: number } | null;
  schedules: { postHash: string; chunks: number; next: number }[];
  cadence: { modeId: string; name: string; every: number; appearance: "chunk" | "full" }[];
}
interface PollResult { mode: string; cost: number; polled: number; landed: { dmId: string; hash: string }[]; replied: { dmId: string }[]; skipped: { dmId: string; reason: string }[]; cursor: number; exhausted: boolean }

export function DmHookPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [last, setLast] = useState<PollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/x/inbox").then((x) => x.json());
    if (r.error) setError(r.error);
    else setInfo(r);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const poll = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/x/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll" }) });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "refused");
      else setLast(j);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const setCadence = async (modeId: string, every: number, appearance: "chunk" | "full") => {
    const r = await fetch("/api/x/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setCadence", modeId, every, appearance }) });
    if (!r.ok) setError((await r.json()).error ?? "refused");
    await refresh();
  };

  return (
    <div data-testid="dm-hook-panel" className="px-4 pb-8">
      {error ? <p data-testid="dm-hook-error" className="my-3 text-[15px] text-x-sec">{error}</p> : null}
      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">DM a link to @totem</h2>
        <p className="text-[13px] leading-4 text-x-sec">
          Send the Totem X account a tweet link from your linked X account and it lands here, in your &ldquo;From X DM&rdquo; folder, and drips into your feed. Unlinked senders get a reply asking them to link first — nothing of theirs is stored.
          {info ? <> Inbox mode: <b data-testid="dm-hook-mode">{info.mode}</b>{info.mode === "live" ? " (read-only; every poll is a ledgered read)" : " (recorded DM shapes; no network)"}. Your linked handle: <b data-testid="dm-hook-handle">{info.linkedHandle ? "@" + info.linkedHandle : "none — link your X account first"}</b>.</> : null}
          {/* PERSONA LAUNCH P8: said BESIDE the mode (dm-hook-mode stays exactly "fixture": accept-mega2-g5 check 7) — never
              present test data as live */}
          {info && info.mode !== "live" ? <> <b data-testid="dm-hook-test-data">Test data: no DM is read from X yet.</b></> : null}
        </p>
        <button data-testid="dm-hook-poll" disabled={busy} onClick={poll} className="mt-3 h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          {busy ? "Polling…" : "Poll the inbox now"}
        </button>
        {last ? (
          <p data-testid="dm-hook-last" data-landed={last.landed.length} data-replied={last.replied.length} data-cost={last.cost} className="mt-2 text-[13px] text-x-sec">
            Polled {last.polled} DMs ({last.mode}, ${last.cost.toFixed(3)}): {last.landed.length} landed, {last.replied.length} unlinked replies, {last.skipped.length} skipped. Cursor {last.cursor}{last.exhausted ? " (inbox exhausted)" : ""}.
          </p>
        ) : null}
      </section>

      {info ? (
        <>
          <section className="border-b border-x-border py-4">
            <h2 className="text-[17px] font-bold leading-6">Landed</h2>
            <p className="text-[13px] text-x-sec" data-testid="dm-hook-folder" data-count={info.folder?.count ?? 0}>
              {info.folder ? `${info.folder.name}: ${info.folder.count} ${info.folder.count === 1 ? "item" : "items"} (private folder)` : "No DM folder yet."}
            </p>
            <ul className="mt-2 space-y-1 text-[13px]" data-testid="dm-hook-schedules" data-count={info.schedules.length}>
              {info.schedules.map((s) => (
                <li key={s.postHash}>{s.postHash}: chunk {s.next}/{s.chunks} surfaced</li>
              ))}
            </ul>
          </section>

          <section className="border-b border-x-border py-4">
            <h2 className="text-[17px] font-bold leading-6">Replies to unlinked senders</h2>
            <p className="text-[13px] text-x-sec">Recorded this session; senders are shown only as hashes, because nothing of theirs is kept.</p>
            <ul className="mt-2 space-y-1 text-[13px]" data-testid="dm-hook-replies" data-count={info.replies.length}>
              {info.replies.map((r) => (
                <li key={r.dmId} data-testid="dm-hook-reply" data-dm={r.dmId} data-sent={r.sent ? "1" : "0"}>
                  {r.dmId} · sender {r.senderHash} · {r.sent ? "sent" : "recorded, not sent"}
                </li>
              ))}
            </ul>
          </section>

          <section className="py-4">
            <h2 className="text-[17px] font-bold leading-6">How DM items reach your feed</h2>
            <p className="text-[13px] text-x-sec">Per mode: surface a DM-sourced item every N feed loads, as a chunk or in full. Eventually they&rsquo;ll read it unless they remove it.</p>
            <table className="mt-2 w-full text-[15px]">
              <tbody>
                {info.cadence.map((c) => (
                  <tr key={c.modeId} className="border-t border-x-border" data-testid={`dm-cadence-${c.modeId}`} data-every={c.every} data-appearance={c.appearance}>
                    <td className="py-2 pr-2">{c.name}</td>
                    <td className="py-2 pr-2">
                      every{" "}
                      <input type="number" min={1} max={20} value={c.every} onChange={(e) => setCadence(c.modeId, Math.max(1, Math.min(20, Number(e.target.value) || 1)), c.appearance)} className="w-14 rounded border border-x-border px-2 py-1" aria-label={`${c.name} DM frequency`} />{" "}
                      loads
                    </td>
                    <td className="py-2">
                      <select value={c.appearance} onChange={(e) => setCadence(c.modeId, c.every, e.target.value as "chunk" | "full")} className="rounded border border-x-border px-2 py-1" aria-label={`${c.name} DM appearance`}>
                        <option value="chunk">as a chunk</option>
                        <option value="full">in full</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
