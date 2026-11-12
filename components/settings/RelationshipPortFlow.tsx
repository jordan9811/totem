"use client";
// MEGA PASS 2 Gate 6 — graduate a relationship from one of your personas to
// another. Pick the counterpart (a Totem persona or an X handle), the
// persona to graduate them to, and a deep old post of theirs to like from
// both of your X accounts a few seconds apart (the deniable breadcrumb).
// The real disclosure is the in-app grant; if they are not on Totem yet it
// waits, and resolves when they link.
//
// PROD-LIVE (D-CU-0-4): the roster and the acting persona arrive as props — from the server on the rig, from the
// browser device on a public deployment (PortingPane reads GET /api/personas/act-as-options there; the server has
// no identity and its fallback is the rig's fixture persona). The ports list is always read from the device-
// answered GET /api/x/port, and NEVER FAILS OPEN: an unread list is shown as an error with a Retry (a re-read, not
// a page load), never as an empty list of ports.
import { useCallback, useEffect, useState } from "react";

// `handles` is absent (and one persona end null) on a row the route REDACTED under compartment mode (GATE 5,
// attack-post-1 F-3b) — the row still renders, without the linkage it withholds
interface Port { id: string; fromPersona: string | null; toPersona: string | null; counterpart: { personaId: string | null; handle: string | null }; handles?: [string, string]; redacted?: boolean; targetPostId: string; delayMs: number; grantId: string | null; status: "issued" | "pending"; state: "scheduled" | "completed"; createdAt: number }
interface Info { ports: Port[]; constants: { dailyCap: number; minDelayMs: number; maxDelayMs: number }; disclaimerAcked: boolean; dailyRemaining: number }

export interface PortPersona {
  id: string;
  handle: string;
  kind: "public" | "private";
}

export function RelationshipPortFlow({ personaId, personas }: { personaId: string; personas: PortPersona[] }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toPersona, setToPersona] = useState(personas.find((p) => p.id !== personaId && p.kind === "public")?.id ?? "");
  const [counterpartKind, setCounterpartKind] = useState<"persona" | "handle">("persona");
  const [counterpart, setCounterpart] = useState("");
  const [targetPostId, setTargetPostId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/x/port", { cache: "no-store" });
      const r = await res.json().catch(() => null);
      if (!res.ok || !r || r.error) throw new Error((r && r.error) || `HTTP ${res.status}`);
      setInfo(r);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "request failed");
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/x/port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPersona: personaId, toPersona, counterpart: counterpartKind === "persona" ? { personaId: counterpart } : { handle: counterpart }, targetPostId }),
      });
      const j = await r.json();
      if (!r.ok) setError(`${j.code ?? "refused"}: ${j.error}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="port-flow" className="px-4 pb-8">
      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Graduate a relationship</h2>
        <p className="text-[13px] leading-4 text-x-sec">
          Someone knows this persona; let them know another of yours. In Totem that is a real, revocable grant to them. On X it is two likes on an old post of theirs from your two accounts, {info ? `${info.constants.minDelayMs / 1000}–${info.constants.maxDelayMs / 1000} s` : "a few seconds"} apart — deniable, and capped at {info?.constants.dailyCap ?? "…"} a day with alt-links. Private personas are never ported.
        </p>
        <div className="mt-3 space-y-2 text-[15px]">
          <label className="block">
            Graduate them to{" "}
            <select data-testid="port-to" value={toPersona} onChange={(e) => setToPersona(e.target.value)} className="rounded border border-x-border px-2 py-1">
              {personas.filter((p) => p.id !== personaId).map((p) => (
                <option key={p.id} value={p.id} disabled={p.kind === "private"}>
                  @{p.handle}{p.kind === "private" ? " (private — never ported)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <select data-testid="port-counterpart-kind" value={counterpartKind} onChange={(e) => setCounterpartKind(e.target.value as "persona" | "handle")} className="rounded border border-x-border px-2 py-1">
              <option value="persona">Totem persona id</option>
              <option value="handle">X handle</option>
            </select>
            <input data-testid="port-counterpart" value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder={counterpartKind === "persona" ? "persona_…" : "@handle"} className="flex-1 rounded border border-x-border px-2 py-1" />
          </div>
          <input data-testid="port-target" value={targetPostId} onChange={(e) => setTargetPostId(e.target.value)} placeholder="a deep old post id of theirs" className="w-full rounded border border-x-border px-2 py-1" />
          <button data-testid="port-submit" disabled={busy || !toPersona || !counterpart || !targetPostId} onClick={submit} className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            Port the relationship
          </button>
          {info && !info.disclaimerAcked ? <p className="text-[13px] text-x-sec">The alt-link disclaimer must be acknowledged first (Settings → Account → X alt linking).</p> : null}
          {info ? <p data-testid="port-remaining" data-remaining={info.dailyRemaining} className="text-[13px] text-x-sec">{info.dailyRemaining} left today.</p> : null}
          {error ? <p data-testid="port-error" className="text-[13px] text-[#f4212e]">{error}</p> : null}
        </div>
      </section>
      <section className="py-4">
        <h2 className="text-[17px] font-bold leading-6">Ports</h2>
        {loadError ? (
          <p data-testid="port-load-error" className="mt-2 text-[13px] text-[#f4212e]">
            Couldn&rsquo;t load your ports. {loadError}{" "}
            <button onClick={() => void refresh()} className="font-bold text-x-blue hover:underline">
              Retry
            </button>
          </p>
        ) : null}
        {loadError && !info ? null : (
          <ul className="mt-2 space-y-2 text-[13px]" data-testid="port-list" data-count={info?.ports.length ?? 0}>
            {(info?.ports ?? []).map((p) => (
              <li key={p.id} data-testid="port" data-status={p.status} data-state={p.state} data-delay={p.delayMs} className="rounded-xl border border-x-border px-3 py-2">
                <p><b>{p.status === "issued" ? "granted" : "pending — resolves when they link"}</b> · {p.fromPersona} → {p.toPersona} · to {p.counterpart.personaId ?? "@" + p.counterpart.handle}</p>
                <p className="text-x-sec">
                  {p.handles
                    ? `likes on ${p.targetPostId} from @${p.handles[0]} and @${p.handles[1]}, ${Math.round(p.delayMs / 100) / 10} s apart · ${p.state}`
                    : `likes on ${p.targetPostId}, ${Math.round(p.delayMs / 100) / 10} s apart · ${p.state} · the other end is hidden under compartment mode`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
