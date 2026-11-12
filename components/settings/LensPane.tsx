"use client";
// MEGA PASS 2 Gate 2 — LENSES: the global algo through different curves.
// Pick a lens, see the SAME feed ranked without and with it side by side,
// see what your accrual last epoch would have been under it, apply it to
// the active mode. Import/export ride the portable-algorithm pipeline.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { LENS_SIGNALS } from "@/lib/lens/types";

interface LensRow { id: string; name: string; summary: string; authorHandle: string; seeded: boolean; spec: { signals: Record<string, number>; influenceDistribution: { early: { enabled: boolean; weight: number }; coordination?: { enabled: boolean; penalty: number } } }; forkedFrom: { authorHandle: string; name: string } | null }
interface PreviewRow { hash: string; author: string; text: string }
interface Preview { lensId: string; current: PreviewRow[]; under: PreviewRow[]; moved: number; delta: { epoch: number; canonical: { score: number; count: number }; underLens: { score: number; count: number } } }

export function LensPane() {
  // PROD-LIVE (D-CU-0-4): refreshApp() is router.refresh() plus a refetch of every island and the device-read chrome
  // (on a public deployment the chrome is the browser device's answer, which a server re-render alone would not re-read)
  const { refresh: refreshApp } = useApp();
  const [lenses, setLenses] = useState<LensRow[]>([]);
  const [active, setActive] = useState<{ id: string; source: string } | null>(null);
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/lenses").then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setLenses(r.lenses);
      setActive(r.active);
      setActiveModeId(r.activeModeId);
      setSelected((s) => s ?? r.active?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Couldn't load lenses.");
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const doPreview = async (id: string) => {
    setBusy(true);
    setSelected(id);
    try {
      const r = await fetch(`/api/lenses?preview=${encodeURIComponent(id)}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setPreview(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doApply = async (id: string | null) => {
    setBusy(true);
    try {
      const r = await fetch("/api/lenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", lensId: id }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await refresh();
      refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doExport = async (id: string) => {
    const r = await fetch(`/api/lenses?export=${encodeURIComponent(id)}`).then((x) => x.json());
    setExported(r.error ? r.error : JSON.stringify(r.artifact, null, 2));
  };
  const doImport = async () => {
    setImportResult(null);
    let artifact: unknown;
    try {
      artifact = JSON.parse(importText);
    } catch {
      setImportResult("not JSON");
      return;
    }
    const p = await fetch("/api/algo/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifact }) }).then((x) => x.json());
    if (p.error) { setImportResult(p.error); return; }
    const pv = p.preview;
    const violations = (pv.violations ?? []).map((v: { where: string; field: string; reason: string }) => `${v.where}.${v.field}: ${v.reason}`).join("; ");
    const inf = pv.influence ? ` · accrual last epoch: ${pv.influence.canonical.score.toFixed(1)} → ${pv.influence.underLens.score.toFixed(1)}` : "";
    const r = await fetch("/api/algo/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifact, activate: true }) }).then((x) => x.json());
    if (r.error) { setImportResult(`refused: ${r.error}${violations ? " — " + violations : ""}`); return; }
    setImportResult(`imported ${r.lens?.name ?? r.mode?.name ?? "artifact"} (hides ${pv.hides}/${pv.total}${inf})${violations ? " — stripped: " + violations : ""}`);
    await refresh();
    refreshApp();
  };

  const selectedLens = lenses.find((l) => l.id === selected) ?? null;

  return (
    <div data-testid="lens-pane" className="px-4 pb-8">
      {error ? <p data-testid="lens-error" className="my-3 text-[15px] text-x-sec">{error}</p> : null}
      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Lenses</h2>
        <p className="text-[13px] leading-4 text-x-sec">A lens is a named weighting over the same signals — what ranks, and how influence is counted. The active mode sees through {active ? <span data-testid="lens-active" data-lens={active.id} data-source={active.source}>{lenses.find((l) => l.id === active.id)?.name ?? active.id} ({active.source})</span> : "…"}.</p>
        <ul className="mt-3 space-y-2" data-testid="lens-list">
          {lenses.map((l) => (
            <li key={l.id} data-testid="lens-row" data-lens={l.id} className={`rounded-2xl border px-3 py-2 ${selected === l.id ? "border-x-blue" : "border-x-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold leading-5">{l.name} <span className="font-normal text-x-sec">· @{l.authorHandle}{l.forkedFrom ? ` · modified from @${l.forkedFrom.authorHandle}'s ${l.forkedFrom.name}` : ""}</span></p>
                  <p className="text-[13px] leading-4 text-x-sec">{l.summary}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button data-testid={`lens-preview-${l.id}`} disabled={busy} onClick={() => doPreview(l.id)} className="h-8 rounded-full border border-x-border px-3 text-[13px] font-bold hover:bg-x-hover">Preview</button>
                  <button data-testid={`lens-apply-${l.id}`} disabled={busy || active?.id === l.id} onClick={() => doApply(l.id)} className="h-8 rounded-full bg-x-blue px-3 text-[13px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">Use</button>
                  <button data-testid={`lens-export-${l.id}`} onClick={() => doExport(l.id)} className="h-8 rounded-full border border-x-border px-3 text-[13px] font-bold hover:bg-x-hover">Share</button>
                </div>
              </div>
              <details className="mt-1 text-[13px] text-x-sec">
                <summary>weights</summary>
                <p>{LENS_SIGNALS.map((s) => `${s} ${l.spec.signals[s] ?? 0}`).join(" · ")}</p>
                <p>early curve {l.spec.influenceDistribution.early.enabled ? `on (×${l.spec.influenceDistribution.early.weight})` : "off"}{l.spec.influenceDistribution.coordination?.enabled ? ` · coordinated staking discounted ${Math.round(l.spec.influenceDistribution.coordination.penalty * 100)}%` : ""}</p>
              </details>
            </li>
          ))}
        </ul>
        {active && active.id !== "lens_canonical" ? (
          <button data-testid="lens-apply-canonical" disabled={busy} onClick={() => doApply(null)} className="mt-3 h-8 rounded-full border border-x-border px-3 text-[13px] font-bold hover:bg-x-hover">Back to canonical</button>
        ) : null}
      </section>

      {preview && selectedLens ? (
        <section className="border-b border-x-border py-4" data-testid="lens-preview" data-lens={preview.lensId} data-moved={preview.moved}>
          <h2 className="text-[17px] font-bold leading-6">The same feed, through {selectedLens.name}</h2>
          <p className="text-[13px] leading-4 text-x-sec">{preview.moved} of {preview.under.length} posts change position.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            <div>
              <p className="font-bold">Now</p>
              <ol className="mt-1 space-y-1" data-testid="lens-preview-current">
                {preview.current.slice(0, 10).map((p, i) => (
                  <li key={p.hash} data-hash={p.hash} className="truncate">{i + 1}. @{p.author}: {p.text}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="font-bold">Under {selectedLens.name}</p>
              <ol className="mt-1 space-y-1" data-testid="lens-preview-under">
                {preview.under.slice(0, 10).map((p, i) => (
                  <li key={p.hash} data-hash={p.hash} className="truncate">{i + 1}. @{p.author}: {p.text}</li>
                ))}
              </ol>
            </div>
          </div>
          <p className="mt-3 text-[15px]" data-testid="lens-influence-delta" data-canonical={preview.delta.canonical.score} data-under={preview.delta.underLens.score}>
            Under this lens, your accrual in epoch {preview.delta.epoch} would have been <b>{preview.delta.underLens.score.toFixed(1)}</b> points ({preview.delta.underLens.count} stewardship) vs <b>{preview.delta.canonical.score.toFixed(1)}</b> ({preview.delta.canonical.count}) under the canonical curves.
          </p>
        </section>
      ) : null}

      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Import a lens</h2>
        <p className="text-[13px] leading-4 text-x-sec">Paste a signed lens artifact. It goes through the same preview and guardrails every algorithm does; a lens that reaches for the destination indicator, correction cards, disclosure, the k-floor or the overdraw rule is refused by name.</p>
        <textarea data-testid="lens-import-text" value={importText} onChange={(e) => setImportText(e.target.value)} rows={4} className="mt-2 w-full rounded border border-x-border px-2 py-1 font-mono text-[12px]" placeholder='{"kind":"lens", ...}' />
        <button data-testid="lens-import" onClick={doImport} className="mt-2 h-8 rounded-full bg-x-blue px-3 text-[13px] font-bold text-white hover:bg-x-blue-hover">Preview and import</button>
        {importResult ? <p data-testid="lens-import-result" className="mt-2 text-[13px] text-x-sec">{importResult}</p> : null}
      </section>

      {exported ? (
        <section className="py-4">
          <h2 className="text-[17px] font-bold leading-6">Signed artifact</h2>
          <pre data-testid="lens-exported" className="mt-2 max-h-64 overflow-auto rounded border border-x-border p-2 text-[11px]">{exported}</pre>
        </section>
      ) : null}
      <p className="sr-only" data-testid="lens-active-mode" data-mode={activeModeId ?? ""} />
    </div>
  );
}
