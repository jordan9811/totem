"use client";
// Badge wallet + "connect a credential" flow with 3 mock issuers.
// Connecting one visibly bumps the tier shown in the graduation panel.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import type { AttestationConnection, AttestationIssuer } from "@/lib/adapters/types";
import { ErrorNote, LoadingRows, Row, SettingsGroup } from "./Chrome";
import { TierBadge } from "../TierBadge";

const TIER_LADDER: { tier: number; unlock: string }[] = [
  { tier: 3, unlock: "Author community notes, appear in discovery" },
  { tier: 5, unlock: "Create custom modes, send posts to timelines" },
  { tier: 7, unlock: "Gate channels by rule, higher discovery weight" },
  { tier: 9, unlock: "Endorsements carry extra weight, top-decile reach" },
];

export function AttestationPane() {
  // PROD-LIVE (D-CU-0-4): refreshApp() is router.refresh() plus a refetch of every island and the device-read chrome
  // (on a public deployment the chrome is the browser device's answer, which a server re-render alone would not re-read)
  const { refresh: refreshApp } = useApp();
  const [issuers, setIssuers] = useState<AttestationIssuer[] | null>(null);
  const [connections, setConnections] = useState<AttestationConnection[]>([]);
  const [tier, setTier] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/attestations");
      if (!res.ok) throw new Error((await res.json()).error ?? "could not load attestations");
      const data = await res.json();
      setIssuers(data.issuers);
      setConnections(data.connections);
      setTier(data.tier);
    } catch (e) {
      setError((e as Error).message);
      setIssuers([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(issuerId: string) {
    setBusy(issuerId);
    setError(null);
    try {
      const res = await fetch("/api/attestations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issuerId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "connection failed");
      const data = await res.json();
      setTier(data.tier);
      await load();
      refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (issuers === null) return <LoadingRows count={3} />;

  const connectedIds = new Set(connections.map((c) => c.issuerId));

  return (
    <>
      <ErrorNote error={error} onRetry={load} />

      <SettingsGroup title="Graduation" note="Reputation lives on your root account and is shared by all your personas.">
        <div className="px-4 py-3">
          <p className="flex items-center text-[15px] leading-5">
            Current tier
            <span data-testid="attestation-tier" className="ml-2 inline-flex items-center">
              <TierBadge tier={tier ?? undefined} />
            </span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-x-pill">
            <div
              className="h-full rounded-full bg-x-blue transition-all"
              style={{ width: `${Math.min(100, ((tier ?? 1) / 10) * 100)}%` }}
            />
          </div>
          <ul className="mt-3">
            {TIER_LADDER.map((step) => {
              const reached = (tier ?? 1) >= step.tier;
              return (
                <li key={step.tier} className="flex items-start py-1.5">
                  <span
                    className={`mr-2 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      reached ? "bg-x-green text-white" : "bg-x-pill text-x-sec"
                    }`}
                  >
                    {step.tier}
                  </span>
                  <span className={`text-[15px] leading-5 ${reached ? "" : "text-x-sec"}`}>{step.unlock}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Badge wallet"
        note="Credentials prove something about you without exposing the underlying record. Connecting one raises your tier."
      >
        {issuers.map((issuer) => {
          const connected = connectedIds.has(issuer.id);
          return (
            <Row
              key={issuer.id}
              testid={`issuer-${issuer.id}`}
              label={issuer.name}
              sub={issuer.description}
              right={
                connected ? (
                  <span className="rounded-full bg-[#00ba7c1a] px-2 py-0.5 text-[13px] font-bold text-x-green">
                    connected
                  </span>
                ) : (
                  <button
                    data-testid={`connect-${issuer.id}`}
                    onClick={() => connect(issuer.id)}
                    disabled={busy !== null}
                    className="h-8 shrink-0 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
                  >
                    {busy === issuer.id ? "Connecting…" : `+${issuer.tierBonus} tier`}
                  </button>
                )
              }
            />
          );
        })}
      </SettingsGroup>
      <div className="h-24" />
    </>
  );
}
