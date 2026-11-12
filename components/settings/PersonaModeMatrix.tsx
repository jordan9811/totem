"use client";
// THE PERSONA × MODE MATRIX — both binding directions, neither forced, on
// one page since that's how a user actually reasons about them together.
// Row 1: each of your personas, its optional default mode. Row 2: each
// mode you own, its optional forced persona and its optional time-based
// activation rule (off by default even when a rule is saved).
import { useCallback, useEffect, useState } from "react";

interface PersonaRow {
  id: string;
  handle: string;
  name: string;
  defaultModeId: string | null;
  timelineUndoDepth: number;
}
interface ModeRow {
  id: string;
  name: string;
  ownerPersonaId: string;
  pinnedPersonaId: string | null;
  activationEnabled: boolean;
  afterHourUTC: number | null;
}

export function PersonaModeMatrix() {
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [modes, setModes] = useState<ModeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/personas/bindings", { cache: "no-store" }).then((r) => r.json());
      setPersonas(j.personas ?? []);
      setModes(j.modes ?? []);
      setError(null);
    } catch {
      setError("Couldn't load the matrix.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/personas/bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "failed");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const modesFor = (personaId: string) => modes.filter((m) => m.ownerPersonaId === personaId);
  const personaHandle = (id: string | null) => (id ? personas.find((p) => p.id === id)?.handle ?? id : null);

  return (
    <div data-testid="persona-mode-matrix">
      {error && <p className="px-4 py-2 text-[13px] text-[#f4212e]">{error}</p>}

      <div className="border-b border-x-border px-4 py-3">
        <h3 className="text-[17px] font-extrabold">Default mode per persona</h3>
        <p className="mt-0.5 text-[13px] text-x-sec">
          Optional. Switching to a persona activates its default mode — unless you&rsquo;ve
          already swiped to a different one this session, which always wins.
        </p>
        {personas.map((p) => (
          <div key={p.id} className="mt-2 flex items-center justify-between" data-testid="persona-row" data-persona={p.id}>
            <span className="text-[15px]">@{p.handle}</span>
            <select
              data-testid={`default-mode-${p.handle}`}
              value={p.defaultModeId ?? ""}
              disabled={busy}
              onChange={(e) => post({ action: "setDefaultMode", personaId: p.id, modeId: e.target.value || null })}
              className="rounded-md border border-[#cfd9de] px-2 py-1 text-[14px]"
            >
              <option value="">None</option>
              {modesFor(p.id).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="border-b border-x-border px-4 py-3">
        <h3 className="text-[17px] font-extrabold">Timeline undo depth</h3>
        <p className="mt-0.5 text-[13px] text-x-sec">
          How many prior refreshes &ldquo;Restore previous&rdquo; can step back through, per persona.
          Default 3. The stack itself is per-browser-session — it never persists.
        </p>
        {personas.map((p) => (
          <div key={p.id} className="mt-2 flex items-center justify-between" data-testid="undo-depth-row" data-persona={p.id}>
            <span className="text-[15px]">@{p.handle}</span>
            <input
              data-testid={`undo-depth-${p.handle}`}
              type="number"
              min={1}
              max={10}
              value={p.timelineUndoDepth}
              disabled={busy}
              onChange={(e) => {
                const depth = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                post({ action: "setUndoDepth", personaId: p.id, depth });
              }}
              className="w-16 rounded-md border border-[#cfd9de] px-2 py-1 text-right text-[14px]"
            />
          </div>
        ))}
      </div>

      <div className="px-4 py-3">
        <h3 className="text-[17px] font-extrabold">Forced persona &amp; activation, per mode</h3>
        <p className="mt-0.5 text-[13px] text-x-sec">
          A mode can force who you act as when it activates. It can also carry a time-based
          auto-switch — off until you turn it on, even after saving an hour.
        </p>
        {modes.map((m) => (
          <div key={m.id} className="mt-3 border-t border-x-border pt-2" data-testid="mode-row" data-mode={m.id}>
            <p className="text-[15px] font-bold">
              {m.name} <span className="text-[13px] font-normal text-x-sec">owned by @{personaHandle(m.ownerPersonaId)}</span>
            </p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[13px] text-x-sec">Forces persona</span>
              <select
                data-testid={`pin-${m.id}`}
                value={m.pinnedPersonaId ?? ""}
                disabled={busy}
                onChange={(e) => post({ action: "setPin", modeId: m.id, personaId: e.target.value || null })}
                className="rounded-md border border-[#cfd9de] px-2 py-1 text-[14px]"
              >
                <option value="">None</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    @{p.handle}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[13px] text-x-sec">Auto-switch after hour (UTC)</span>
              <div className="flex items-center gap-2">
                <input
                  data-testid={`activation-hour-${m.id}`}
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={m.afterHourUTC ?? ""}
                  disabled={busy}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    post({ action: "setActivation", modeId: m.id, enabled: m.activationEnabled, afterHourUTC: v });
                  }}
                  className="w-16 rounded-md border border-[#cfd9de] px-2 py-1 text-[14px]"
                  placeholder="off"
                />
                <label className="flex items-center gap-1 text-[13px]">
                  <input
                    data-testid={`activation-enabled-${m.id}`}
                    type="checkbox"
                    checked={m.activationEnabled}
                    disabled={busy || m.afterHourUTC === null}
                    onChange={(e) =>
                      post({ action: "setActivation", modeId: m.id, enabled: e.target.checked, afterHourUTC: m.afterHourUTC })
                    }
                  />
                  enabled
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
