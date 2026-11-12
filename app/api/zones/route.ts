import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 3 — SCROLL ZONES (per device, private).
// GET                                   this device's config (or the default) + the presets + the device fingerprint
// POST {action:"save", config}          validate (shape, then the edge-gesture band) and seal for this device
// POST {action:"preset", layout, viewport, insetPx?}   the same, from a preset
// POST {action:"hitTest", config?, x, y, viewport}      what a point would scroll (the calibration overlay's own check)
import { createHash } from "@/lib/platform/crypto";
import { hitTest, presetConfig, sanitizeZoneConfig, type ZoneLayout } from "@/lib/zones/types";
import { saveZoneConfigForThisDevice, thisDeviceKey, zoneConfigForThisDevice } from "@/lib/zones/store";

export const dynamic = "force-dynamic";

const PRESETS: Exclude<ZoneLayout, "custom">[] = ["default", "reading", "left-handed", "right-handed"];
const fingerprint = () => createHash("sha256").update(thisDeviceKey()).digest("hex").slice(0, 8);

export async function GET() {
  try {
    const { config, saved } = await zoneConfigForThisDevice();
    return NextResponse.json({ config, saved, device: fingerprint(), presets: PRESETS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "save" || body.action === "preset") {
      let raw: unknown = body.config;
      if (body.action === "preset") {
        const layout = String(body.layout ?? "");
        if (!PRESETS.includes(layout as Exclude<ZoneLayout, "custom">)) return NextResponse.json({ error: "unknown preset" }, { status: 400 });
        const vp = body.viewport as { w?: unknown; h?: unknown } | undefined;
        const viewport = { w: Number(vp?.w ?? 1280), h: Number(vp?.h ?? 800) };
        raw = presetConfig(layout as Exclude<ZoneLayout, "custom">, viewport, body.insetPx === undefined ? undefined : Number(body.insetPx));
      }
      const r = await saveZoneConfigForThisDevice(raw);
      if (!r.ok) return NextResponse.json({ error: r.reason, code: r.code, violations: r.violations ?? [] }, { status: r.code === "edge" ? 422 : 400 });
      return NextResponse.json({ ok: true, config: r.config, device: fingerprint() });
    }
    if (body.action === "hitTest") {
      const cfg = body.config !== undefined ? sanitizeZoneConfig(body.config).config : (await zoneConfigForThisDevice()).config;
      if (!cfg) return NextResponse.json({ error: "config malformed" }, { status: 400 });
      const vp = body.viewport as { w?: unknown; h?: unknown } | undefined;
      const viewport = { w: Number(vp?.w ?? cfg.viewport.w), h: Number(vp?.h ?? cfg.viewport.h) };
      return NextResponse.json({ target: hitTest(cfg, Number(body.x), Number(body.y), viewport) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
