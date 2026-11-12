"use client";
// POST-DEPLOY Gate 2 — the tint editor, and the scope switches in the one
// place an owner goes looking for "which persona am I".
//
// A tint is never published: it is not part of a persona's profile, no viewer
// of that persona can see it, and it is stored in the vault like every other
// device preference. The copy says so, because a colour that looked public
// would change what people are willing to use it for.
import { useCallback, useEffect, useState } from "react";

interface Tint {
  personaId: string;
  handle: string;
  color: string;
  source: "chosen" | "auto";
  wash: string;
}
interface Scope {
  unified: boolean;
  unifiedRequested: boolean;
  compartment: boolean;
  activePersonaId: string;
  visiblePersonaIds: string[];
  reason: string;
}

export function PersonaTintPane() {
  const [tints, setTints] = useState<Tint[]>([]);
  const [palette, setPalette] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/persona/chrome", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "chrome unavailable");
      setTints(j.tints ?? []);
      setPalette(j.palette ?? []);
      setScope(j.scope ?? null);
      setActiveId(j.activePersonaId ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await fetch("/api/persona/chrome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="persona-tint-pane" className="px-4 py-3">
      <p className="text-[15px] leading-5 text-x-sec">
        Each persona carries an accent colour on the app chrome — the rails, the header, the tab bar —
        never on a post. It is a cue for you, on this device: it is stored in your vault, it is never
        sent to the validator in the clear, and nobody who can see this persona can see its colour.
      </p>
      <p className="mt-2 text-[15px] leading-5 text-x-sec">
        The colour is never the only cue. The handle is in the chrome in text at every width, and the
        current mode rides the same element as a border treatment (solid, dashed, dotted, double), so
        both stay readable in greyscale and to someone who cannot separate two of these hues.
      </p>

      {error ? (
        <p data-testid="persona-tint-error" className="mt-3 rounded-xl border border-x-border px-3 py-2 text-[15px] text-[#f4212e]">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 space-y-3">
        {tints.map((t) => (
          <li
            key={t.personaId}
            data-testid="persona-tint-row"
            data-persona={t.personaId}
            data-handle={t.handle}
            data-color={t.color}
            data-source={t.source}
            className="rounded-2xl border border-x-border p-3"
            style={{ backgroundImage: `linear-gradient(${t.wash}, ${t.wash})` }}
          >
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="text-[15px] font-bold">@{t.handle}</span>
              {t.personaId === activeId ? (
                <span className="rounded-full bg-x-pill px-2 py-0.5 text-[11px] font-bold text-x-sec">active</span>
              ) : null}
              <span className="ml-auto text-[13px] text-x-sec">
                {t.source === "chosen" ? "chosen" : "auto — a default no sibling is using"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {palette.map((c) => (
                <button
                  key={c}
                  data-testid="persona-tint-swatch"
                  data-color={c}
                  aria-label={"Set @" + t.handle + " to " + c}
                  disabled={busy !== null}
                  onClick={() => void post({ action: "tint", personaId: t.personaId, color: c }, t.personaId + c)}
                  className={`h-7 w-7 rounded-full border-2 disabled:opacity-50 ${t.color === c ? "border-x-text" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              {t.source === "chosen" ? (
                <button
                  data-testid="persona-tint-clear"
                  disabled={busy !== null}
                  onClick={() => void post({ action: "clearTint", personaId: t.personaId }, t.personaId + "clear")}
                  className="ml-1 h-7 rounded-full border border-x-border px-3 text-[13px] font-bold disabled:opacity-50"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div
        data-testid="persona-scope-pane"
        data-unified={scope?.unified ? "1" : "0"}
        data-compartment={scope?.compartment ? "1" : "0"}
        data-visible={scope?.visiblePersonaIds.length ?? 0}
        className="mt-5 rounded-2xl border border-x-border p-3"
      >
        <h3 className="text-[15px] font-bold">Seeing more than one persona at once</h3>
        <label className="mt-2 flex items-center gap-2 text-[15px]">
          <input
            data-testid="persona-scope-unified"
            type="checkbox"
            disabled={busy !== null || !!scope?.compartment}
            checked={!!scope?.unified}
            onChange={(e) => void post({ action: "unified", on: e.target.checked }, "unified")}
          />
          Cross-persona view (search, bookmarks, likes, stakes, relationship events)
        </label>
        <p className="mt-1 text-[13px] leading-4 text-x-sec">
          Off by default, and it is a read-only view: acting as a persona still takes a switch or the
          act-as picker, because signing as a persona is a disclosure and does not belong behind a
          convenience toggle.
        </p>
        <button
          data-testid="persona-scope-compartment"
          disabled={busy !== null}
          onClick={() => void post({ action: "compartment", on: !scope?.compartment }, "compartment")}
          className={`mt-3 h-9 rounded-full border px-4 text-[15px] font-bold disabled:opacity-50 ${
            scope?.compartment ? "border-x-blue bg-x-blue text-white" : "border-x-border"
          }`}
        >
          {scope?.compartment ? "Leave compartment mode" : "Compartment mode (one tap, for a shared screen)"}
        </button>
        <p className="mt-1 text-[13px] leading-4 text-x-sec">
          {scope?.compartment
            ? "On: this device answers for the active persona only — the search index, the account switcher, the act-as picker and a sibling's stake history, all at the API rather than by hiding a menu."
            : "Scopes this device hard to the active persona and forces the cross-persona view off. Leaving it does not turn that view back on."}
        </p>
      </div>
    </div>
  );
}
