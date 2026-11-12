"use client";
// PAY-TO-DM — non-mutuals pay to land in your inbox; a reply refunds them,
// ignoring past the window keeps the fee (the spam slash). Mutuals bypass.
//
// PROD-LIVE (D-CU-0-4): which messages are INBOUND and which are SENT depends on who "you" are. On the rig the server
// passes the seeded acting persona; on a public deployment the server has no persona (it used to pass the fixture
// persona — the owner's — so a visitor's inbox was split against someone else), and the persona is the device's
// acting persona from the chrome (useApp().actingPersonaId). Nothing is read until it is known.
//
// NEVER FAIL OPEN: a failed read is an error with a Retry, never "No messages yet."
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { readApiJson } from "@/lib/client/useApiJson";
import { IslandLoading, RetryButton } from "@/components/spaces/IslandStatus";

interface Dm {
  id: string;
  fromPersona: string;
  toPersona: string;
  text: string;
  status: "pending" | "replied" | "slashed";
  escrowId: string | null;
}

export function DmInbox({ personaId: serverPersonaId }: { personaId?: string }) {
  const { actingPersonaId, rosterStatus, rosterError, refresh: refreshChrome } = useApp();
  const personaId = serverPersonaId ?? actingPersonaId;
  const [dms, setDms] = useState<Dm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [dmRes, priceRes] = await Promise.all([
        readApiJson<{ dms?: Dm[] }>("/api/market/infofi?surface=dms"),
        readApiJson<{ dmPrice?: number }>("/api/market/infofi?surface=prices"),
      ]);
      setDms(dmRes.dms ?? []);
      setPrice(priceRes.dmPrice ?? null);
      setLoaded(true);
      setError(null);
    } catch {
      setError("Couldn't load messages. It will retry on the next action.");
    }
  }, []);

  useEffect(() => {
    if (personaId) refresh();
  }, [refresh, personaId]);

  const reply = async (dmId: string) => {
    await fetch("/api/market/infofi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "replyDm", dmId }),
    });
    refresh();
  };

  // public deployment, before the device has said who is acting
  if (!personaId) {
    return (
      <div data-testid="dm-inbox">
        {rosterStatus === "error" ? (
          <div data-testid="dm-persona-error" className="flex flex-wrap items-center px-4 py-3">
            <p className="text-[15px] text-x-sec">
              Couldn&rsquo;t tell which persona you&rsquo;re acting as. {rosterError}
            </p>
            <RetryButton onRetry={refreshChrome} testid="dm-persona-retry" />
          </div>
        ) : (
          <IslandLoading testid="dm-loading" rows={2} />
        )}
      </div>
    );
  }

  const inbound = dms.filter((d) => d.toPersona === personaId);
  const outbound = dms.filter((d) => d.fromPersona === personaId);

  return (
    <div data-testid="dm-inbox">
      <div className="border-b border-x-border px-4 py-3">
        <p className="text-[13px] leading-4 text-x-sec" data-testid="dm-price-note">
          Non-mutuals pay {price ?? "…"} to message you. Replying refunds them;
          ignoring past the window keeps the fee. Mutuals message free.
        </p>
      </div>

      {error && (
        <div className="flex flex-wrap items-center px-4 py-3">
          <p className="text-[15px] text-x-sec">{error}</p>
          <RetryButton onRetry={refresh} testid="dm-retry" />
        </div>
      )}

      {loaded && inbound.length === 0 && outbound.length === 0 && !error && (
        <p className="px-4 py-6 text-[15px] text-x-sec">No messages yet.</p>
      )}

      {inbound.map((dm) => (
        <div key={dm.id} data-testid="dm-row" data-dm={dm.id} data-status={dm.status} className="border-b border-x-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] leading-5">{dm.text}</p>
              <p className="mt-0.5 text-[13px] text-x-sec">
                {dm.escrowId ? "paid message" : "mutual — free"} · {dm.status}
              </p>
            </div>
            {dm.status === "pending" && (
              <button
                data-testid="dm-reply"
                onClick={() => reply(dm.id)}
                className="h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white"
              >
                Reply (refunds)
              </button>
            )}
          </div>
        </div>
      ))}

      {outbound.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="text-[15px] font-bold text-x-sec">Sent</h3>
          {outbound.map((dm) => (
            <p key={dm.id} data-testid="dm-sent" data-status={dm.status} className="mt-1 text-[13px] text-x-sec">
              {dm.text} — {dm.status === "slashed" ? "ignored; fee kept by recipient" : dm.status}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
