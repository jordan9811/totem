"use client";
// POST-DEPLOY Gate 3 — THE MANAGEMENT SCREEN.
//
// Every account you have moved off Normal, in every mode, in one list. The
// point is reviewability: a setting made from a cast menu six weeks ago, on an
// account you no longer think about, is otherwise invisible until it surprises
// you. "Normal" is never stored, so this list IS the complete non-normal set by
// construction rather than by filtering something larger.
import { useCallback, useEffect, useState } from "react";
import { TIER_BLURB, TIER_LABEL, type DeliveryTier } from "../DeliveryTierPicker";

interface Row {
  personaId: string;
  modeId: string;
  modeName: string;
  tier: DeliveryTier;
  handle: string;
  name: string | null;
  activeHere: boolean;
}

export function DeliveryTiersPane() {
  const [rows, setRows] = useState<Row[]>([]);
  const [activeMode, setActiveMode] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/delivery", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "delivery unavailable");
      setRows(j.rows ?? []);
      setActiveMode(j.activeMode ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(row: Row, tier: DeliveryTier) {
    const key = row.modeId + "|" + row.personaId;
    setBusy(key);
    setError(null);
    try {
      const r = await fetch("/api/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: row.personaId, modeId: row.modeId, tier }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not change the tier");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const byMode = new Map<string, Row[]>();
  for (const r of rows) (byMode.get(r.modeName) ?? byMode.set(r.modeName, []).get(r.modeName)!).push(r);

  return (
    <div data-testid="delivery-pane" data-rows={rows.length} className="px-4 py-3">
      <p className="text-[15px] leading-5 text-x-sec">
        Delivery is per account AND per mode, so the same person can be someone you never miss in one
        mode and someone you have turned down in another. This lists every account you have moved off
        Normal — Normal is the absence of a setting, so nothing is hidden from this page.
      </p>
      {activeMode ? (
        <p className="mt-1 text-[13px] text-x-sec">
          You are in <span className="font-bold">{activeMode.name}</span> right now.
        </p>
      ) : null}

      {error ? (
        <p data-testid="delivery-pane-error" className="mt-3 rounded-xl border border-x-border px-3 py-2 text-[15px] text-[#f4212e]">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p data-testid="delivery-empty" className="mt-4 text-[15px] text-x-sec">
          Nothing is set. Every account you follow is delivered Normally — open the menu on any post to
          change where that account shows up.
        </p>
      ) : null}

      {[...byMode.entries()].map(([modeName, list]) => (
        <section key={modeName} data-testid="delivery-mode-group" data-mode={modeName} className="mt-4">
          <h3 className="text-[15px] font-bold">
            {modeName}
            <span className="ml-1.5 font-normal text-x-sec">· {list.length}</span>
          </h3>
          <ul className="mt-1 divide-y divide-x-border">
            {list.map((row) => (
              <li
                key={row.modeId + "|" + row.personaId}
                data-testid="delivery-row"
                data-persona={row.personaId}
                data-mode-id={row.modeId}
                data-tier={row.tier}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <span className="text-[15px] font-bold">@{row.handle}</span>
                <span className="text-[13px] text-x-sec">{TIER_BLURB[row.tier]}</span>
                <select
                  data-testid="delivery-row-select"
                  aria-label={"Delivery for @" + row.handle + " in " + row.modeName}
                  disabled={busy !== null}
                  value={row.tier}
                  onChange={(e) => void change(row, e.target.value as DeliveryTier)}
                  className="ml-auto h-8 rounded-full border border-x-border px-2 text-[13px] font-bold disabled:opacity-50"
                >
                  {(Object.keys(TIER_LABEL) as DeliveryTier[]).map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
