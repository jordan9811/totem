"use client";
// MEGA PASS 2 Gate 1 — THE INFLUENCE LAYER. Everything the default UI keeps
// quiet about the reputation UBI lives here, and only here: the epoch's
// allowance, the per-action stake defaults and directions, the settled
// stewardship, your own stake history, and the coordination view over the
// public rows — legibility, not enforcement.
//
// PROD-LIVE (D-CU-0-4): "your stake history" is the ACTING persona's. On a public deployment the server's
// activeSeedPersonaId() is the rig's fixture persona, so the page showed the fixture's stakes as the visitor's.
// InfluenceIsland takes the persona from the server on the rig and from the browser device
// (useApp().actingPersonaId) on a public deployment, waiting until it is known. A history the route refused or
// could not read is said to be unread — never rendered as "No stakes yet."
import { useCallback, useEffect, useState } from "react";
import { STAKE_ACTIONS, STAKE_DIRECTIONS, type StakeAction, type StakeDirection } from "@/lib/influence/types";
import { ErrorNote, LoadingRows } from "./Chrome";
import { useActingPersona } from "./useActingPersona";
import { NoPersonaYet } from "@/components/world/NoPersonaYet";

interface Allowance {
  epoch: number;
  allowance: number;
  remaining: number;
  tier: number;
  defaults: Record<StakeAction, number>;
  directions: Record<StakeAction, StakeDirection>;
}
interface Stake { id: string; castHash: string; action: string; direction: string; amount: number; epoch: number; at: number; personaId: string }
interface Cluster { epoch: number; direction: string; members: string[]; casts: string[]; amount: number }
interface Accrual { epoch: number; evaluatedEpoch: number; score: number; count: number; evaluated: number; confirmed: number }

/**
 * PROD-LIVE (D-CU-0-4): the page mounts this. `serverPersonaId` is activeSeedPersonaId() on the rig and null on a
 * public deployment, where the acting persona is the device's answer — until it is known the pane waits.
 */
export function InfluenceIsland({ serverPersonaId }: { serverPersonaId: string | null }) {
  const acting = useActingPersona(serverPersonaId);
  if (acting.personaId) return <InfluencePane personaId={acting.personaId} />;
  // LAYERS_WORLD=empty (review F6): no persona yet — nothing to stake as; said, never "Loading…" forever
  if (acting.state === "none") return <NoPersonaYet what="Staking" />;
  if (acting.state === "error") {
    return <ErrorNote error={`Couldn't tell which persona you're acting as. ${acting.error ?? ""}`} onRetry={acting.retry} />;
  }
  return <LoadingRows count={4} />;
}

export function InfluencePane({ personaId }: { personaId: string }) {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [history, setHistory] = useState<Stake[]>([]);
  // PROD-LIVE (never fail open): a history that was refused or unreadable is NOT an empty history
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [clusters, setClusters] = useState<{ epoch: number; clusters: Cluster[] } | null>(null);
  const [accruals, setAccruals] = useState<Accrual[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settle, setSettle] = useState<{ posted: boolean; record: Accrual; evaluation: { evaluated: number; confirmed: number; score: number; count: number; items: { castHash: string; direction: string; amount: number; confirmed: boolean; reason: string; earlyRank: number; weight: number }[] } } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, h, c, acc] = await Promise.all([
        fetch("/api/influence?view=allowance").then((r) => r.json()),
        fetch(`/api/influence?view=history&personaId=${encodeURIComponent(personaId)}`).then((r) => r.json()),
        fetch("/api/influence?view=clusters").then((r) => r.json()),
        fetch("/api/influence?view=accruals").then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      setAllowance(a.allowance);
      if (h.error || !Array.isArray(h.stakes)) {
        setHistoryError(String(h.error ?? "the history came back without its stakes"));
        setHistory([]);
      } else {
        setHistoryError(null);
        setHistory(h.stakes);
      }
      setClusters(c.error ? null : { epoch: c.epoch, clusters: c.clusters ?? [] });
      setAccruals(acc.accruals ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Couldn't load the influence layer. It will retry on the next action.");
    }
  }, [personaId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setDefault = async (action: StakeAction, amount: number) => {
    const r = await fetch("/api/influence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setSettings", defaults: { [action]: amount } }) });
    if (!r.ok) setNotice((await r.json()).error ?? "refused");
    await refresh();
  };
  const setDirection = async (action: StakeAction, direction: StakeDirection) => {
    const r = await fetch("/api/influence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setSettings", directions: { [action]: direction } }) });
    if (!r.ok) setNotice((await r.json()).error ?? "refused");
    await refresh();
  };
  const doSettle = async () => {
    setNotice(null);
    const r = await fetch("/api/influence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settle" }) });
    const j = await r.json();
    if (!r.ok) { setNotice(j.error ?? "refused"); setSettle(null); } else setSettle(j);
    await refresh();
  };

  return (
    <div data-testid="influence-pane" className="px-4 pb-8">
      {error ? <p data-testid="influence-error" className="my-3 text-[15px] text-x-sec">{error}</p> : null}
      {notice ? <p data-testid="influence-notice" className="my-3 text-[15px] text-x-sec">{notice}</p> : null}

      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Allowance</h2>
        <p className="text-[13px] leading-4 text-x-sec">A recurring, non-transferable allowance of influence per epoch. Acting spends some of it as a stake; nothing here can be sent to anyone.</p>
        {allowance ? (
          <div className="mt-3" data-testid="influence-allowance" data-epoch={allowance.epoch} data-remaining={allowance.remaining} data-allowance={allowance.allowance} data-tier={allowance.tier}>
            <div className="flex items-baseline gap-2">
              <span className="text-[26px] font-black leading-8">{allowance.remaining}</span>
              <span className="text-[15px] text-x-sec">of {allowance.allowance} left this epoch · epoch {allowance.epoch} · from tier {allowance.tier}</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-x-hover">
              <div className="h-2 rounded-full bg-x-blue" style={{ width: `${allowance.allowance ? Math.round((100 * allowance.remaining) / allowance.allowance) : 0}%` }} />
            </div>
            {allowance.allowance === 0 ? <p className="mt-2 text-[13px] text-x-sec">No allowance this epoch: nothing proven yet. It arrives with your first tier proof.</p> : null}
          </div>
        ) : (
          <p className="mt-3 text-[15px] text-x-sec">Loading…</p>
        )}
      </section>

      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Stake per action</h2>
        <p className="text-[13px] leading-4 text-x-sec">The default spent when you act. Zero is allowed — the action still works, nothing is staked. The direction is what your stake says about the content.</p>
        {allowance ? (
          <table className="mt-3 w-full text-[15px]">
            <tbody>
              {STAKE_ACTIONS.map((action) => (
                <tr key={action} className="border-t border-x-border" data-testid={`influence-default-${action}`}>
                  <td className="py-2 pr-2 capitalize">{action}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={allowance.defaults[action]}
                      onChange={(e) => setDefault(action, Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                      className="w-16 rounded border border-x-border px-2 py-1"
                      aria-label={`${action} stake`}
                    />
                  </td>
                  <td className="py-2">
                    <select value={allowance.directions[action]} onChange={(e) => setDirection(action, e.target.value as StakeDirection)} className="rounded border border-x-border px-2 py-1" aria-label={`${action} direction`}>
                      {STAKE_DIRECTIONS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Stewardship</h2>
        <p className="text-[13px] leading-4 text-x-sec">Stakes are evaluated one epoch later against what the notes and refutations say by then. What holds up accrues reputation on your account — the same reputation every tier proof is built from.</p>
        <button data-testid="influence-settle" onClick={doSettle} className="mt-3 h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
          Settle the last epoch
        </button>
        {settle ? (
          <div className="mt-3 text-[15px]" data-testid="influence-settle-result" data-count={settle.record.count} data-posted={settle.posted ? "1" : "0"}>
            <p>Epoch {settle.record.evaluatedEpoch}: {settle.evaluation.confirmed} of {settle.evaluation.evaluated} stakes confirmed, score {settle.evaluation.score.toFixed(2)}, {settle.record.count} stewardship {settle.record.count === 1 ? "event" : "events"} {settle.posted ? "posted" : "(already settled)"}.</p>
            <ul className="mt-2 space-y-1 text-[13px] text-x-sec">
              {settle.evaluation.items.map((i) => (
                <li key={i.castHash + i.direction + i.amount}>{i.castHash} · {i.direction} · {i.amount} · rank {i.earlyRank} · {i.confirmed ? "confirmed" : "unconfirmed"} — {i.reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {accruals.length ? (
          <ul className="mt-3 space-y-1 text-[13px] text-x-sec" data-testid="influence-accruals">
            {accruals.map((a) => (
              <li key={a.evaluatedEpoch}>epoch {a.evaluatedEpoch}: {a.confirmed}/{a.evaluated} confirmed → {a.count} stewardship</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Your stake history</h2>
        <p className="text-[13px] leading-4 text-x-sec">Always visible to you. Others see it at this persona&rsquo;s disclosure level — the same level that governs its linkage.</p>
        {historyError ? (
          <p className="mt-3 text-[15px] text-[#f4212e]" data-testid="influence-history-error">
            Couldn&rsquo;t read your stake history. {historyError}{" "}
            <button onClick={() => void refresh()} className="font-bold text-x-blue hover:underline">
              Retry
            </button>
          </p>
        ) : history.length ? (
          <ul className="mt-3 space-y-1 text-[13px]" data-testid="influence-history" data-count={history.length}>
            {history.slice(-50).reverse().map((s) => (
              <li key={s.id} data-testid="influence-history-row" data-direction={s.direction} data-amount={s.amount}>
                epoch {s.epoch} · {s.action} · <span className="font-medium">{s.direction}</span> · {s.amount} on {s.castHash}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px] text-x-sec">No stakes yet.</p>
        )}
      </section>

      <section className="py-4">
        <h2 className="text-[17px] font-bold leading-6">Coordination view</h2>
        <p className="text-[13px] leading-4 text-x-sec">Groups of accounts that staked the same direction on the same posts in one epoch. Detectable by anyone from the public rows; a lens may weight against it. Nothing is enforced.</p>
        {clusters ? (
          clusters.clusters.length ? (
            <ul className="mt-3 space-y-2 text-[13px]" data-testid="influence-clusters" data-epoch={clusters.epoch} data-count={clusters.clusters.length}>
              {clusters.clusters.map((c, i) => (
                <li key={i} data-testid="influence-cluster" data-members={c.members.length} data-casts={c.casts.length}>
                  <span className="font-medium">{c.members.length} accounts</span> staked <span className="font-medium">{c.direction}</span> on {c.casts.length} shared posts in epoch {c.epoch} ({c.amount} total): {c.members.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[15px] text-x-sec" data-testid="influence-clusters" data-epoch={clusters.epoch} data-count={0}>No coordinated clusters in epoch {clusters.epoch}.</p>
          )
        ) : null}
      </section>
    </div>
  );
}
