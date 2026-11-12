// MEGA PASS 2 Gate 3 — SCROLL ZONES: screen regions map to scroll targets.
// Pure (no node, no server-only): the calibration pane, the client-side
// wheel router and the API's validator all read this one file.
//
// The default is the whole screen = the timeline (X's behaviour, untouched).
// A "reading" layout maps an OUTER band to the timeline and the CENTER to
// in-timeline long-form scroll, so reading an article never ejects you from
// the feed. Zones are layout config the long-form cards consume; they are
// per-DEVICE, private (vault), and calibrated by the user DRAWING them on a
// live preview of their own screen.
//
// SYSTEM-GESTURE SAFETY: a zone may never claim the OS edge-gesture bands.
// A reading zone that overlaps the inset (default 20 px, configurable) on
// any edge is refused at save time — the refusal names the edge. The
// timeline zone is the base and is always allowed everywhere. Real-device
// tuning is required: mobile behaviour is UNMEASURED in this build.

export type ScrollTarget = "timeline" | "longform";
export type ZoneLayout = "default" | "reading" | "left-handed" | "right-handed" | "custom";

/** a rectangle in PERCENT of the viewport (0..100), so a config survives a resize */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone {
  id: string;
  target: ScrollTarget;
  rect: ZoneRect;
}

export interface ZoneConfig {
  layout: ZoneLayout;
  /** evaluated in order; the LAST zone containing the point wins; an empty list = the whole screen is the timeline */
  zones: Zone[];
  /** the OS edge-gesture inset, in px */
  insetPx: number;
  /** the viewport the user calibrated on (px) — the edge-band check is a px check */
  viewport: { w: number; h: number };
  savedAt: number;
}

export const DEFAULT_INSET_PX = 20;
export const MIN_INSET_PX = 0;
export const MAX_INSET_PX = 120;

const READING_CENTER: ZoneRect = { x: 20, y: 15, w: 60, h: 70 };

export function presetZones(layout: Exclude<ZoneLayout, "custom">): Zone[] {
  switch (layout) {
    case "default":
      return [];
    case "reading":
      return [{ id: "reading-center", target: "longform", rect: { ...READING_CENTER } }];
    case "left-handed":
      // the reading band sits toward the left thumb; the right edge stays timeline
      return [{ id: "reading-left", target: "longform", rect: { x: 8, y: 15, w: 60, h: 70 } }];
    case "right-handed":
      return [{ id: "reading-right", target: "longform", rect: { x: 32, y: 15, w: 60, h: 70 } }];
  }
}

export function presetConfig(layout: Exclude<ZoneLayout, "custom">, viewport: { w: number; h: number }, insetPx = DEFAULT_INSET_PX): ZoneConfig {
  return { layout, zones: presetZones(layout), insetPx, viewport, savedAt: 0 };
}

export const DEFAULT_ZONE_CONFIG: ZoneConfig = Object.freeze({ layout: "default", zones: [], insetPx: DEFAULT_INSET_PX, viewport: { w: 1280, h: 800 }, savedAt: 0 });

/** which target a point (px, viewport coordinates) scrolls, under a config on a viewport */
export function hitTest(config: Pick<ZoneConfig, "zones">, x: number, y: number, viewport: { w: number; h: number }): ScrollTarget {
  let target: ScrollTarget = "timeline";
  for (const z of config.zones) {
    const l = (z.rect.x / 100) * viewport.w;
    const t = (z.rect.y / 100) * viewport.h;
    const r = l + (z.rect.w / 100) * viewport.w;
    const b = t + (z.rect.h / 100) * viewport.h;
    if (x >= l && x < r && y >= t && y < b) target = z.target;
  }
  return target;
}

export interface ZoneViolation {
  zoneId: string;
  edge: "top" | "bottom" | "left" | "right";
  reason: string;
}

/** the edge-gesture rule, in px on the calibrated viewport: a non-timeline zone may not enter the inset band */
export function edgeViolations(config: Pick<ZoneConfig, "zones" | "insetPx" | "viewport">): ZoneViolation[] {
  const out: ZoneViolation[] = [];
  const { w, h } = config.viewport;
  const inset = config.insetPx;
  for (const z of config.zones) {
    if (z.target === "timeline") continue;
    const l = (z.rect.x / 100) * w;
    const t = (z.rect.y / 100) * h;
    const r = l + (z.rect.w / 100) * w;
    const b = t + (z.rect.h / 100) * h;
    if (l < inset) out.push({ zoneId: z.id, edge: "left", reason: `the ${z.target} zone reaches ${Math.round(l)} px from the left edge; the OS edge-gesture band is ${inset} px` });
    if (t < inset) out.push({ zoneId: z.id, edge: "top", reason: `the ${z.target} zone reaches ${Math.round(t)} px from the top edge; the OS edge-gesture band is ${inset} px` });
    if (r > w - inset) out.push({ zoneId: z.id, edge: "right", reason: `the ${z.target} zone reaches ${Math.round(w - r)} px from the right edge; the OS edge-gesture band is ${inset} px` });
    if (b > h - inset) out.push({ zoneId: z.id, edge: "bottom", reason: `the ${z.target} zone reaches ${Math.round(h - b)} px from the bottom edge; the OS edge-gesture band is ${inset} px` });
  }
  return out;
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** shape check — never repairs; a malformed config is refused with the field named */
export function sanitizeZoneConfig(raw: unknown): { config: ZoneConfig | null; reason?: string } {
  const c = raw as Partial<ZoneConfig> | null;
  if (!c || typeof c !== "object") return { config: null, reason: "not an object" };
  const layouts: ZoneLayout[] = ["default", "reading", "left-handed", "right-handed", "custom"];
  if (!layouts.includes(c.layout as ZoneLayout)) return { config: null, reason: "layout unknown" };
  const insetPx = num(c.insetPx, MIN_INSET_PX, MAX_INSET_PX);
  if (insetPx === null) return { config: null, reason: `insetPx must be ${MIN_INSET_PX}..${MAX_INSET_PX}` };
  const vw = num(c.viewport?.w, 200, 10000);
  const vh = num(c.viewport?.h, 200, 10000);
  if (vw === null || vh === null) return { config: null, reason: "viewport must be 200..10000 px on each side" };
  if (!Array.isArray(c.zones) || c.zones.length > 8) return { config: null, reason: "zones must be a list of at most 8" };
  const zones: Zone[] = [];
  const ids = new Set<string>();
  for (const z of c.zones as Partial<Zone>[]) {
    if (!z || typeof z !== "object") return { config: null, reason: "zone malformed" };
    if (typeof z.id !== "string" || !/^[a-z0-9-]{1,32}$/.test(z.id) || ids.has(z.id)) return { config: null, reason: "zone id malformed or duplicated" };
    if (z.target !== "timeline" && z.target !== "longform") return { config: null, reason: `zone ${z.id}: target unknown` };
    const x = num(z.rect?.x, 0, 100), y = num(z.rect?.y, 0, 100), w = num(z.rect?.w, 1, 100), h = num(z.rect?.h, 1, 100);
    if (x === null || y === null || w === null || h === null || x + w > 100.0001 || y + h > 100.0001) return { config: null, reason: `zone ${z.id}: rect must sit inside the viewport (percent)` };
    ids.add(z.id);
    zones.push({ id: z.id, target: z.target, rect: { x, y, w, h } });
  }
  return { config: { layout: c.layout as ZoneLayout, zones, insetPx, viewport: { w: vw, h: vh }, savedAt: typeof c.savedAt === "number" ? c.savedAt : 0 } };
}
