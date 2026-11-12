"use client";
import { useCallback, useEffect, useState } from "react";
import { CAST_ACTIONS, CAST_ACTION_LABELS, castRowFor } from "@/lib/actions/bindings";
import { useApp } from "@/components/Providers";
import type { ModeDefinition, RankingWeights, Rule } from "@/lib/adapters/types";
import { AD_DIALS, AD_DIAL_LABELS, FORCED_OFF_SENTENCE, type AdDial, type DialAnswer } from "@/lib/ads/dial";
import { ADS_DORMANT_SENTENCE } from "@/lib/ads/switch";
import { adsCall } from "@/components/ads/useAdPlan";
import { ErrorNote, LoadingRows, Row, SettingsGroup, Toggle } from "./Chrome";

/** ADS, PHASE 1: what the acting identity hid (kept sealed on this device), and "show them all again" */
function HiddenAds() {
  const [state, setState] = useState<{ actor: string | null; lots: { id: string; label: string }[]; advertisers: { id: string; label: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await adsCall<{ actor: string | null; lots: { id: string; label: string }[]; advertisers: { id: string; label: string }[] }>({ op: "hidden" });
    if (r.ok) {
      setState(r.data);
      setError(null);
    } else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const n = state ? state.lots.length + state.advertisers.length : 0;
  return (
    <SettingsGroup title="Ads you've hidden" note="Kept sealed on this device, for the identity acting now only. A persona's hidden ads never apply to you, or yours to it.">
      <div data-testid="ads-hidden" data-count={state ? n : ""} className="px-4 py-2 text-[15px] leading-5">
        {error ? (
          <p data-testid="ads-hidden-error" className="text-x-sec">
            {error}
          </p>
        ) : !state ? (
          <p className="text-x-sec">Checking…</p>
        ) : n === 0 ? (
          <p className="text-x-sec">None. Hide an ad from its menu and it is listed here.</p>
        ) : (
          <>
            <ul className="list-disc pl-5">
              {state.lots.map((l) => (
                <li key={"l:" + l.id}>{l.label}</li>
              ))}
              {state.advertisers.map((a) => (
                <li key={"a:" + a.id}>Every ad from {a.label}</li>
              ))}
            </ul>
            <button
              type="button"
              data-testid="ads-show-all"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await adsCall<{ ok: true }>({ op: "showAll", actor: state.actor });
                setBusy(false);
                if (!r.ok) setError(r.error);
                else void load();
              }}
              className="mt-2 h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50"
            >
              Show them all again
            </button>
          </>
        )}
      </div>
    </SettingsGroup>
  );
}

const COMPOSER_SLOTS = ["media", "gif", "poll", "emoji", "schedule", "location"];
const NAV_SLOTS = ["home", "explore", "notifications", "messages", "bookmarks", "modes"];

export function ModeBuilder() {
  // PROD-LIVE (D-CU-0-4): refreshApp() is router.refresh() plus a refetch of every island and the device-read chrome
  // (on a public deployment the chrome is the browser device's answer, which a server re-render alone would not re-read)
  const { refresh: refreshApp } = useApp();
  const [modes, setModes] = useState<ModeDefinition[] | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adDials, setAdDials] = useState<Record<string, DialAnswer>>({});
  const [adsRunning, setAdsRunning] = useState(false);
  const [editing, setEditing] = useState<ModeDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [modeRes, ruleRes] = await Promise.all([fetch("/api/modes"), fetch("/api/rules")]);
      if (!modeRes.ok) throw new Error((await modeRes.json()).error ?? "could not load modes");
      const modeData = await modeRes.json();
      setModes(modeData.modes);
      setActiveId(modeData.activeId);
      setAdDials(modeData.adDials ?? {});
      setAdsRunning(modeData.adsRunning === true);
      if (ruleRes.ok) setRules((await ruleRes.json()).rules);
    } catch (e) {
      setError((e as Error).message);
      setModes([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mutate(fn: () => Promise<Response>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error((await res.json()).error ?? "request failed");
      await load();
      refreshApp();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (modes === null) return <LoadingRows count={4} />;

  if (editing) {
    return (
      <ModeEditor
        mode={editing}
        dial={adDials[editing.id] ?? null}
        adsRunning={adsRunning}
        rules={rules}
        busy={busy}
        error={error}
        onCancel={() => setEditing(null)}
        onSave={async (patch) => {
          const ok = await mutate(
            () =>
              fetch("/api/modes", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modeId: editing.id, patch }),
              }),
            "save"
          );
          if (ok) setEditing(null);
        }}
      />
    );
  }

  return (
    <>
      <ErrorNote error={error} onRetry={load} />
      <SettingsGroup title="Your modes" note="A mode bundles a persona, ranking weights, filter rules, notification policy, and action button bindings.">
        {modes.map((mode) => (
          <div key={mode.id} className="border-b border-x-border last:border-b-0">
            <Row
              testid={`mode-row-${mode.name.toLowerCase().replace(/\s+/g, "-")}`}
              label={mode.name}
              sub={`${mode.ruleIds.length} rule${mode.ruleIds.length === 1 ? "" : "s"} · ${mode.notificationPolicy.replace("_", " ")} · trending ${mode.showTrending ? "on" : "off"}${mode.isPreset ? " · preset" : ""}${adDials[mode.id] ? " · " + AD_DIAL_LABELS[adDials[mode.id].dial].toLowerCase() : ""}`}
              right={
                mode.id === activeId ? (
                  <span className="rounded-full bg-[#00ba7c1a] px-2 py-0.5 text-[13px] font-bold text-x-green">active</span>
                ) : null
              }
            />
            <div className="flex gap-2 px-4 pb-3">
              <button
                data-testid={`mode-edit-${mode.name.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setEditing(mode)}
                className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
              >
                Edit
              </button>
              <button
                onClick={() =>
                  mutate(
                    () =>
                      fetch("/api/modes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ duplicateOf: mode.id, name: `${mode.name} copy` }),
                      }),
                    "duplicate"
                  )
                }
                disabled={busy !== null}
                className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50"
              >
                Duplicate
              </button>
              {!mode.isPreset && (
                <button
                  onClick={() => mutate(() => fetch(`/api/modes?modeId=${mode.id}`, { method: "DELETE" }), "delete")}
                  disabled={busy !== null}
                  className="h-8 rounded-full border border-[#fdc9ce] px-3 text-[13px] font-bold text-[#f4212e] hover:bg-[#f4212e0d] disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              {mode.id !== activeId && (
                <button
                  data-testid={`mode-activate-${mode.name.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() =>
                    mutate(
                      () =>
                        fetch("/api/modes/active", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ modeId: mode.id }),
                        }),
                      "activate"
                    )
                  }
                  disabled={busy !== null}
                  className="ml-auto h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
                >
                  Use
                </button>
              )}
            </div>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Create">
        <Row
          testid="create-mode"
          label="New mode"
          sub="Starts from Default's settings"
          onClick={() =>
            mutate(
              () =>
                fetch("/api/modes", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: `Mode ${modes.length + 1}` }),
                }),
              "create"
            )
          }
          right={<span className="text-[15px] font-bold text-x-blue">Create</span>}
        />
      </SettingsGroup>
      <HiddenAds />
      <div className="h-24" />
    </>
  );
}

function ModeEditor({
  mode,
  dial,
  adsRunning,
  rules,
  busy,
  error,
  onCancel,
  onSave,
}: {
  mode: ModeDefinition;
  /** ADS, PHASE 1: the dial as it applies to this mode (its own setting, the default, or forced off) */
  dial: DialAnswer | null;
  /** DORMANT (lib/ads/switch.ts): ads are switched on on this site; off, the dial is still editable and says so */
  adsRunning: boolean;
  rules: Rule[];
  busy: string | null;
  error: string | null;
  onCancel: () => void;
  onSave: (patch: Partial<ModeDefinition>) => void;
}) {
  const [name, setName] = useState(mode.name);
  const [ranking, setRanking] = useState<RankingWeights>(mode.ranking);
  const [ruleIds, setRuleIds] = useState<string[]>(mode.ruleIds);
  const [notificationPolicy, setNotificationPolicy] = useState(mode.notificationPolicy);
  const [caughtUp, setCaughtUp] = useState(mode.caughtUp ?? "new");
  const [filterPackIds, setFilterPackIds] = useState<string[]>(mode.filterPackIds ?? []);
  const [availablePacks, setAvailablePacks] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch("/api/packs", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAvailablePacks(j.packs ?? []))
      .catch(() => setAvailablePacks([]));
  }, []);
  const [showTrending, setShowTrending] = useState(mode.showTrending);
  const [calmRanking, setCalmRanking] = useState(mode.calmRanking);
  const [composer, setComposer] = useState<string[]>(mode.actionButtonSlots.composer);
  const [nav, setNav] = useState<string[]>(mode.actionButtonSlots.nav);
  // MEGA PASS 2 Gate 3: the per-cast action row's bindings (X's row when the mode has none)
  const [castRow, setCastRow] = useState<string[]>(castRowFor(mode.actionButtonSlots));
  // ADS, PHASE 1: saved only when chosen here, so a mode left on its default keeps following the default
  const [adDial, setAdDial] = useState<AdDial | null>(dial?.dial ?? null);
  const [adDialChosen, setAdDialChosen] = useState(false);

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div data-testid="mode-editor">
      <ErrorNote error={error} />
      <SettingsGroup title="Name">
        <div className="px-4 pb-2">
          <input
            data-testid="mode-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-[4px] border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Ranking weights" note="How the timeline orders posts in this mode.">
        {(Object.keys(ranking) as (keyof RankingWeights)[]).map((key) => (
          <div key={key} className="px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[15px] leading-5">
                {key === "authorAffinity" ? "Author affinity" : key === "clusterAffinity" ? "Topic affinity" : key[0].toUpperCase() + key.slice(1)}
              </span>
              <span className="text-[13px] text-x-sec">{ranking[key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ranking[key]}
              onChange={(e) => setRanking({ ...ranking, [key]: Number(e.target.value) })}
              className="mt-1 w-full accent-[#1d9bf0]"
            />
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Filter rules" note="Rules are evaluated by the shared rules engine — the same one the rule builder previews against.">
        {rules.map((rule) => (
          <Row
            key={rule.id}
            testid={`mode-rule-${rule.id}`}
            label={rule.name}
            sub={`action: ${rule.action}`}
            right={
              <Toggle
                on={ruleIds.includes(rule.id)}
                onChange={() => setRuleIds(toggleIn(ruleIds, rule.id))}
                testid={`mode-rule-toggle-${rule.id}`}
              />
            }
          />
        ))}
        {rules.length === 0 && <p className="px-4 py-2 text-[15px] text-x-sec">No rules yet. Build one in Rules &amp; Filters.</p>}
      </SettingsGroup>

      <SettingsGroup title="Feed behavior">
        <Row label="Show trending" right={<Toggle on={showTrending} onChange={setShowTrending} testid="toggle-trending" />} />
        <Row
          label="Calm ranking"
          sub="Damps high-engagement outliers"
          right={<Toggle on={calmRanking} onChange={setCalmRanking} testid="toggle-calm" />}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Ads in this mode"
        note="Picked on your device. Generic ads are the same for everyone; matched ones fit this mode's name, never anything about you. Nobody counts what you saw."
      >
        {!adsRunning ? (
          <p data-testid="mode-ads-dormant" className="px-4 pt-2 text-[15px] leading-5 text-x-sec">
            {ADS_DORMANT_SENTENCE}
          </p>
        ) : null}
        {dial?.forced ? (
          <p data-testid="mode-ad-dial-forced" className="px-4 py-2 text-[15px] leading-5 text-x-sec">
            {FORCED_OFF_SENTENCE}
          </p>
        ) : (
          <div data-testid="mode-ad-dial" data-dial={adDial ?? ""} data-default={dial?.isDefault && !adDialChosen ? "true" : "false"} className="flex flex-wrap gap-2 px-4 py-2">
            {AD_DIALS.map((d) => (
              <button
                key={d}
                type="button"
                data-testid={`mode-ad-dial-${d}`}
                aria-pressed={adDial === d}
                onClick={() => {
                  setAdDial(d);
                  setAdDialChosen(true);
                }}
                className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${adDial === d ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"}`}
              >
                {AD_DIAL_LABELS[d]}
              </button>
            ))}
            {dial?.isDefault && !adDialChosen ? <span className="self-center text-[13px] text-x-sec">(the default for this identity)</span> : null}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <div className="flex gap-2 px-4 py-2">
          {(["all", "mentions_only", "muted"] as const).map((policy) => (
            <button
              key={policy}
              onClick={() => setNotificationPolicy(policy)}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${
                notificationPolicy === policy ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {policy.replace("_", " ")}
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Filter packs"
        note="Imported network-state packs. Off unless attached — and attached per mode, so Work can run a pack Default doesn't."
      >
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {availablePacks.length === 0 && (
            <p className="text-[13px] text-x-sec">No packs imported yet.</p>
          )}
          {availablePacks.map((p) => (
            <button
              key={p.id}
              data-testid={"pack-toggle-" + p.id}
              onClick={() => setFilterPackIds(toggleIn(filterPackIds, p.id))}
              className={"h-8 rounded-full px-3 text-[13px] font-bold transition-colors " + (
                filterPackIds.includes(p.id) ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Caught-up banner"
        note="When everything new this mode admits has been shown, the feed stops. Aggressive also counts topics you're saturated on as seen."
      >
        <div className="flex gap-2 px-4 py-2">
          {(["off", "new", "aggressive"] as const).map((c) => (
            <button
              key={c}
              data-testid={`caughtup-${c}`}
              onClick={() => setCaughtUp(c)}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${
                caughtUp === c ? "bg-x-black-btn text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {c === "new" ? "after new content" : c}
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Action buttons" note="Which controls this mode binds into the composer and nav slots.">
        <p className="px-4 pt-1 text-[13px] font-bold text-x-sec">Composer</p>
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {COMPOSER_SLOTS.map((slot) => (
            <button
              key={slot}
              onClick={() => setComposer(toggleIn(composer, slot))}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${
                composer.includes(slot) ? "bg-x-blue text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {slot}
            </button>
          ))}
        </div>
        <p className="px-4 pt-1 text-[13px] font-bold text-x-sec">Nav</p>
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {NAV_SLOTS.map((slot) => (
            <button
              key={slot}
              onClick={() => setNav(toggleIn(nav, slot))}
              className={`h-8 rounded-full px-3 text-[13px] font-bold transition-colors ${
                nav.includes(slot) ? "bg-x-blue text-white" : "border border-[#cfd9de] hover:bg-x-hover"
              }`}
            >
              {slot}
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Cast actions" note="The per-cast action row in this mode. The default is X's row exactly; long-press any button on a card to rebind it.">
        {castRow.map((a, i) => (
          <div key={i} className="flex items-center gap-2 px-4 py-1.5" data-testid={`mode-cast-slot-${i}`}>
            <span className="w-14 text-[13px] text-x-sec">slot {i + 1}</span>
            <select
              value={a}
              onChange={(e) => setCastRow(castRow.map((x, j) => (j === i ? e.target.value : x)))}
              className="rounded border border-[#cfd9de] px-2 py-1 text-[15px]"
              aria-label={`cast slot ${i + 1}`}
            >
              {CAST_ACTIONS.map((opt) => (
                <option key={opt} value={opt} disabled={castRow.includes(opt) && opt !== a}>
                  {CAST_ACTION_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </SettingsGroup>

      <div className="flex gap-2 px-4 py-4">
        <button
          data-testid="mode-save"
          onClick={() =>
            onSave({
              name,
              ranking,
              ruleIds,
              notificationPolicy,
              caughtUp,
              filterPackIds,
              showTrending,
              calmRanking,
              actionButtonSlots: { composer, nav, cast: castRow },
              ...(adDialChosen && adDial && !dial?.forced ? { adDial } : {}),
            })
          }
          disabled={busy !== null}
          className="h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="h-9 rounded-full border border-[#cfd9de] px-4 text-[15px] font-bold hover:bg-x-hover">
          Cancel
        </button>
      </div>
      <div className="h-24" />
    </div>
  );
}
