"use client";
// MEGA PASS 2 Gate 3 — SCROLL ZONE CALIBRATION. The user DRAWS the reading
// zone on a live, scaled preview of their own screen (drag the body to
// move it, a corner handle to resize it), watches the hit-test overlay say
// what each point would scroll, and saves per device. Presets: default,
// reading, left-handed, right-handed. A zone that overlaps the OS
// edge-gesture band is refused at save with the edge named — the inset
// bands are drawn on the preview so the refusal is never a surprise.
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_INSET_PX, edgeViolations, hitTest, presetZones, type ScrollTarget, type Zone, type ZoneConfig, type ZoneLayout } from "@/lib/zones/types";

const PREVIEW_W = 360;

type Drag = { zoneId: string; mode: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; rect: Zone["rect"] } | null;

export function ScrollZonesPane() {
  const [config, setConfig] = useState<ZoneConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [device, setDevice] = useState<string>("");
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const [hover, setHover] = useState<{ x: number; y: number; target: ScrollTarget } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const drag = useRef<Drag>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/zones").then((x) => x.json());
    if (r.error) { setRefusal(r.error); return; }
    const vp = { w: window.innerWidth, h: window.innerHeight };
    setViewport(vp);
    setConfig({ ...r.config, viewport: r.saved ? r.config.viewport : vp });
    setSaved(!!r.saved);
    setDevice(r.device ?? "");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const scale = PREVIEW_W / (config?.viewport.w ?? viewport.w);
  const previewH = Math.round((config?.viewport.h ?? viewport.h) * scale);

  const applyPreset = (layout: Exclude<ZoneLayout, "custom">) => {
    setRefusal(null);
    setConfig((c) => ({ ...(c ?? { insetPx: DEFAULT_INSET_PX, savedAt: 0, viewport }), layout, zones: presetZones(layout), viewport: c?.viewport ?? viewport, insetPx: c?.insetPx ?? DEFAULT_INSET_PX }));
  };

  const toPct = (px: number, total: number) => (px / scale / total) * 100;

  const onPointerDown = (e: React.PointerEvent, zoneId: string, mode: NonNullable<Drag>["mode"]) => {
    if (!config) return;
    const z = config.zones.find((x) => x.id === zoneId);
    if (!z) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { zoneId, mode, startX: e.clientX, startY: e.clientY, rect: { ...z.rect } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!config || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const vp = config.viewport;
    if (px >= 0 && py >= 0 && px <= b.width && py <= b.height) {
      const x = px / scale;
      const y = py / scale;
      setHover({ x, y, target: hitTest(config, x, y, vp) });
    } else {
      setHover(null);
    }
    const d = drag.current;
    if (!d) return;
    const dx = toPct(e.clientX - d.startX, vp.w);
    const dy = toPct(e.clientY - d.startY, vp.h);
    const r = { ...d.rect };
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (d.mode === "move") {
      r.x = clamp(d.rect.x + dx, 0, 100 - d.rect.w);
      r.y = clamp(d.rect.y + dy, 0, 100 - d.rect.h);
    } else {
      if (d.mode.includes("w")) { const nx = clamp(d.rect.x + dx, 0, d.rect.x + d.rect.w - 5); r.w = d.rect.w + (d.rect.x - nx); r.x = nx; }
      if (d.mode.includes("e")) r.w = clamp(d.rect.w + dx, 5, 100 - d.rect.x);
      if (d.mode.includes("n")) { const ny = clamp(d.rect.y + dy, 0, d.rect.y + d.rect.h - 5); r.h = d.rect.h + (d.rect.y - ny); r.y = ny; }
      if (d.mode.includes("s")) r.h = clamp(d.rect.h + dy, 5, 100 - d.rect.y);
    }
    setConfig((c) => (c ? { ...c, layout: "custom", zones: c.zones.map((z) => (z.id === d.zoneId ? { ...z, rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) } } : z)) } : c));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const saveNow = async () => {
    if (!config) return;
    setRefusal(null);
    setNotice(null);
    const r = await fetch("/api/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", config }) });
    const j = await r.json();
    if (!r.ok) {
      setRefusal((j.error ?? "refused") + (j.violations?.length ? " — " + j.violations.map((v: { reason: string }) => v.reason).join("; ") : ""));
      return;
    }
    setConfig(j.config);
    setSaved(true);
    setNotice("Saved for this device.");
  };

  const liveViolations = config ? edgeViolations(config) : [];
  const insetPct = config ? { x: (config.insetPx / config.viewport.w) * 100, y: (config.insetPx / config.viewport.h) * 100 } : { x: 0, y: 0 };

  return (
    <div data-testid="zones-pane" className="px-4 pb-8">
      <section className="border-b border-x-border py-4">
        <h2 className="text-[17px] font-bold leading-6">Scroll zones</h2>
        <p className="text-[13px] leading-4 text-x-sec">Draw where scrolling reads the article and where it moves the timeline. Saved for this device only ({device ? `device ${device}` : "…"}). Mobile behaviour is unmeasured in this build — tune on a real device.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["default", "reading", "left-handed", "right-handed"] as const).map((p) => (
            <button key={p} data-testid={`zones-preset-${p}`} onClick={() => applyPreset(p)} className={`h-8 rounded-full border px-3 text-[13px] font-bold hover:bg-x-hover ${config?.layout === p ? "border-x-blue" : "border-x-border"}`}>
              {p}
            </button>
          ))}
        </div>
      </section>

      {config ? (
        <section className="border-b border-x-border py-4">
          <p className="text-[13px] text-x-sec">
            Preview of your {config.viewport.w}×{config.viewport.h} screen. Inset {config.insetPx} px.{" "}
            <label className="ml-2">inset <input data-testid="zones-inset" type="number" min={0} max={120} value={config.insetPx} onChange={(e) => setConfig({ ...config, insetPx: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} className="w-16 rounded border border-x-border px-1" /></label>
          </p>
          <div
            ref={box}
            data-testid="zones-preview"
            data-layout={config.layout}
            data-zones={config.zones.length}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            className="relative mt-2 select-none overflow-hidden rounded-xl border border-x-border bg-white"
            style={{ width: PREVIEW_W, height: previewH, touchAction: "none" }}
          >
            {/* the mock timeline: a header, a composer, some cards */}
            <div className="absolute inset-x-0 top-0 h-[6%] border-b border-x-border bg-white/90" />
            <div className="absolute inset-x-[8%] top-[8%] h-[7%] rounded bg-x-hover" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="absolute inset-x-[8%] rounded border border-x-border" style={{ top: `${18 + i * 13}%`, height: "11%" }}>
                <div className="m-[3%] h-[20%] w-[30%] rounded bg-x-hover" />
                <div className="mx-[3%] h-[15%] w-[80%] rounded bg-x-hover" />
              </div>
            ))}
            {/* the OS edge-gesture bands */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-[repeating-linear-gradient(45deg,#f4212e22,#f4212e22_4px,transparent_4px,transparent_8px)]" style={{ height: `${insetPct.y}%` }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(45deg,#f4212e22,#f4212e22_4px,transparent_4px,transparent_8px)]" style={{ height: `${insetPct.y}%` }} />
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,#f4212e22,#f4212e22_4px,transparent_4px,transparent_8px)]" style={{ width: `${insetPct.x}%` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-[repeating-linear-gradient(45deg,#f4212e22,#f4212e22_4px,transparent_4px,transparent_8px)]" style={{ width: `${insetPct.x}%` }} />
            {/* the zones */}
            {config.zones.map((z) => (
              <div
                key={z.id}
                data-testid={`zone-${z.id}`}
                data-x={z.rect.x}
                data-y={z.rect.y}
                data-w={z.rect.w}
                data-h={z.rect.h}
                onPointerDown={(e) => onPointerDown(e, z.id, "move")}
                className={`absolute cursor-move rounded-md border-2 ${liveViolations.some((v) => v.zoneId === z.id) ? "border-[#f4212e] bg-[#f4212e1a]" : "border-x-blue bg-[#1d9bf01a]"}`}
                style={{ left: `${z.rect.x}%`, top: `${z.rect.y}%`, width: `${z.rect.w}%`, height: `${z.rect.h}%` }}
              >
                <span className="absolute left-1 top-0.5 text-[11px] font-bold text-x-blue">{z.target === "longform" ? "reading" : "timeline"}</span>
                {(["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span
                    key={h}
                    data-testid={`zone-${z.id}-${h}`}
                    onPointerDown={(e) => onPointerDown(e, z.id, h)}
                    className="absolute h-3 w-3 rounded-sm border border-white bg-x-blue"
                    style={{ [h.includes("n") ? "top" : "bottom"]: -6, [h.includes("w") ? "left" : "right"]: -6, cursor: `${h}-resize` }}
                  />
                ))}
              </div>
            ))}
            {hover ? (
              <div data-testid="zones-hit" data-target={hover.target} className="pointer-events-none absolute rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white" style={{ left: Math.min(PREVIEW_W - 70, hover.x * scale + 8), top: Math.min(previewH - 20, hover.y * scale + 8) }}>
                {hover.target === "longform" ? "reads the article" : "scrolls the timeline"}
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button data-testid="zones-save" onClick={saveNow} className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">Save for this device</button>
            <span data-testid="zones-state" data-saved={saved ? "1" : "0"} data-saved-at={config.savedAt} data-layout={config.layout} className="text-[13px] text-x-sec">{saved ? `saved ${config.savedAt ? new Date(config.savedAt).toLocaleTimeString() : ""}` : "not saved on this device yet"}</span>
          </div>
          {liveViolations.length ? (
            <p data-testid="zones-live-warning" className="mt-2 text-[13px] text-[#f4212e]">This zone reaches the {liveViolations.map((v) => v.edge).join(", ")} edge band — saving will be refused until it moves.</p>
          ) : null}
          {refusal ? <p data-testid="zones-refusal" className="mt-2 text-[13px] text-[#f4212e]">{refusal}</p> : null}
          {notice ? <p data-testid="zones-notice" className="mt-2 text-[13px] text-x-sec">{notice}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
