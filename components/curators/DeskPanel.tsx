"use client";
// THE DESK — curator issuance. Drafts with signature progress, the sign
// button for invited co-signers, and the curator's public record. The
// "Curating as" chrome follows the private-persona-composer pattern: the
// acting identity is always on screen, and it is a PERSONA — the root never
// appears on this surface (the leak grep holds it to that).
//
// PROD-LIVE (D-CU-0-4): on the rig the server names the acting persona's handle; on a public deployment the server
// has no persona (it used to name the fixture persona — the owner's handle — to every visitor), so the handle is the
// device's acting persona, looked up in the device's roster (useApp). Until that is known the chrome says so rather
// than naming anyone. NEVER FAIL OPEN: an unread desk is an error with a Retry, never "No drafts in flight".
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { readApiJson } from "@/lib/client/useApiJson";
import { RetryButton } from "@/components/spaces/IslandStatus";

interface DeskDraft {
  id: string;
  feedId: string;
  status: "pending" | "issued";
  targetCastId: string;
  claim: string;
  evidenceLink: string;
  createdByHandle: string;
  signedHandles: string[];
  awaitingHandles: string[];
  threshold: number;
  canSign: boolean;
}

interface DeskFeed {
  id: string;
  name: string;
  threshold: number;
  curators: string[];
  accuracy: { concur: number; dispute: number; accuracy: number | null };
}

interface CuratorRecord {
  feedId: string;
  feedName: string;
  issuedSigned: number;
  accuracy: { concur: number; dispute: number; accuracy: number | null };
}

export function DeskPanel({ activeHandle: serverHandle = null }: { activeHandle?: string | null }) {
  const { personas, actingPersonaId, rosterStatus, rosterError, refresh: refreshChrome } = useApp();
  // the server's answer on the rig; the device's on a public deployment ("you" is the old fallback for a persona the
  // store has no handle for — used only once the roster has actually been read)
  const activeHandle =
    serverHandle ??
    (rosterStatus === "ready" && actingPersonaId
      ? personas.find((p) => p.id === actingPersonaId)?.handle ?? "you"
      : null);
  const [drafts, setDrafts] = useState<DeskDraft[]>([]);
  const [feeds, setFeeds] = useState<DeskFeed[]>([]);
  const [record, setRecord] = useState<CuratorRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await readApiJson<{ drafts?: DeskDraft[]; feeds?: DeskFeed[]; curatorRecord?: CuratorRecord[] }>(
        "/api/curators"
      );
      setDrafts(j.drafts ?? []);
      setFeeds(j.feeds ?? []);
      setRecord(j.curatorRecord ?? []);
      setLoaded(true);
      setError(null);
    } catch {
      setError("Couldn't load the desk. It will retry on the next action.");
    }
  }, []);

  // on a public deployment the drafts are the DEVICE's acting persona's: nothing is read until the device has said who
  // that is, and a persona switch there re-reads them (the rig's server names the persona and keeps its old read-once
  // behaviour: the key is constant there)
  const deviceMode = serverHandle === null;
  const personaKey = deviceMode ? actingPersonaId : null;
  useEffect(() => {
    if (deviceMode && !personaKey) return;
    refresh();
  }, [refresh, deviceMode, personaKey]);

  const sign = async (draftId: string) => {
    const res = await fetch("/api/curators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign", draftId }),
    });
    const j = await res.json();
    if (res.ok && j.draft?.status === "issued") setJustIssued(draftId);
    refresh();
  };

  return (
    <div data-testid="desk-panel">
      <div className="border-b border-x-border px-4 py-2" data-testid="curating-as">
        <p
          className="text-[13px] text-x-sec"
          aria-busy={activeHandle === null && rosterStatus !== "error" ? true : undefined}
        >
          {activeHandle !== null ? (
            <>
              Curating as <span className="font-bold">@{activeHandle}</span> — annotations you sign
              carry this persona, nothing else.
            </>
          ) : rosterStatus === "error" ? (
            <>
              Couldn&rsquo;t confirm which persona you&rsquo;re curating as. {rosterError}
              <RetryButton onRetry={refreshChrome} testid="curating-as-retry" />
            </>
          ) : (
            <>Confirming which persona you&rsquo;re curating as…</>
          )}
        </p>
      </div>

      {error && (
        <div className="flex flex-wrap items-center px-4 py-3">
          <p className="text-[15px] text-x-sec">{error}</p>
          <RetryButton onRetry={refresh} testid="desk-retry" />
        </div>
      )}

      {loaded && drafts.length === 0 && !error && (
        <p className="px-4 py-6 text-[15px] text-x-sec" data-testid="desk-empty">
          No drafts in flight for this persona. Drafts are visible only to the
          curators invited to sign them.
        </p>
      )}

      {drafts.map((d) => (
        <div key={d.id} data-testid="desk-draft" data-draft={d.id} data-status={d.status} className="border-b border-x-border px-4 py-3">
          <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
            {feeds.find((f) => f.id === d.feedId)?.name ?? d.feedId}
          </p>
          <p className="mt-0.5 text-[15px] leading-5">{d.claim}</p>
          <p className="mt-0.5 text-[13px] text-x-sec">
            on {d.targetCastId.slice(0, 12)}… · drafted by @{d.createdByHandle}
          </p>
          {d.status === "issued" || justIssued === d.id ? (
            <p className="mt-1.5 text-[13px] font-bold text-[#00ba7c]" data-testid="draft-live">
              Issued — live on every subscribed surface.
            </p>
          ) : (
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-[13px] text-x-sec" data-testid="draft-progress">
                {d.signedHandles.length} of {d.threshold} signatures
                {d.awaitingHandles.length > 0 && (
                  <> — awaiting {d.awaitingHandles.map((h) => "@" + h).join(", ")}</>
                )}
              </p>
              {d.canSign && (
                <button
                  data-testid="draft-sign"
                  onClick={() => sign(d.id)}
                  className="h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white"
                >
                  Sign
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {record.length > 0 && (
        <div className="px-4 py-4" data-testid="curator-record">
          <h3 className="text-[17px] font-extrabold">Your curator record</h3>
          {record.map((r) => (
            <p key={r.feedId} className="mt-1.5 text-[15px]" data-testid={`record-${r.feedId}`}>
              {r.feedName}: {r.issuedSigned} issued with your signature ·{" "}
              {r.accuracy.accuracy === null
                ? "no community verdicts yet"
                : `${r.accuracy.accuracy}% concur (${r.accuracy.concur} concur / ${r.accuracy.dispute} dispute)`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
