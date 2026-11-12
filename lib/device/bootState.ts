// PROD-LIVE (D-CU-0-4) — the device's boot state, shared by the device bundle (lib/device/entry.ts, built into
// public/device/device.js) and the page that mounts it (components/device/DeviceHostMount.tsx, DeviceStatus.tsx).
// No imports on purpose: this module is compiled into BOTH bundles, and the page half must not drag the device's
// route shims into the Next client chunk.
//
// Why it exists: public/device/boot.js queues every same-origin /api/* fetch until the device installs its fetch
// host (D-CU-3-THE-FETCH-PATCH-HAS-AN-EARLY-HALF). Before this pass a boot failure was a console.error and nothing
// else, so every queued read — and every read after it — waited forever and the page was an infinite spinner. Now a
// failure is VISIBLE and FINAL for this document:
//   * every queued request is answered with a 503 JSON `{ error: "device failed to start: <reason>" }`, so each
//     island renders its own error state (useApiJson reads `error` from the body) instead of hanging;
//   * `window.__layersDeviceFailed` holds the reason, and boot.js answers every LATER /api/* fetch the same way;
//   * a `layers:device` window event announces the state, which DeviceStatus renders (booting / slow / ready /
//     failed + Retry). The same event announces "ready" when the host installs.
// Never fail open: a failed device is never presented as an empty account.

export const DEVICE_EVENT = "layers:device";

export type DeviceBootState = "booting" | "ready" | "failed";

export interface DeviceEventDetail {
  state: DeviceBootState;
  reason?: string | null;
  /** public values only (anchor, root id, persona ids, restored, persistent) — never key material */
  info?: unknown;
}

interface Queued {
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
interface BootWindow {
  __layersFetchQueue?: Queued[];
  __layersDeviceInstalled?: boolean;
  __layersDeviceFailed?: string;
}

const win = (): BootWindow | null => (typeof window === "undefined" ? null : (window as unknown as BootWindow));

/** what this document's device is doing right now */
export function deviceBootState(): { state: DeviceBootState; reason: string | null } {
  const w = win();
  if (!w) return { state: "booting", reason: null };
  if (w.__layersDeviceInstalled) return { state: "ready", reason: null };
  if (typeof w.__layersDeviceFailed === "string") return { state: "failed", reason: w.__layersDeviceFailed };
  return { state: "booting", reason: null };
}

/** the answer a request gets once the device has failed to start (boot.js builds the same one for later fetches) */
export function deviceFailedResponse(reason: string): Response {
  return new Response(JSON.stringify({ error: "device failed to start: " + reason, code: "device_failed" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

/**
 * PERSONA LAUNCH wave 3 (final verify) — a prefetch tick landed in THIS document's device (lib/zk/prefetch.ts runTick).
 * The privacy label is computed from what the device holds (the tick's snapshot among it), and since wave 3 a tab's
 * first composer read runs its first tick at once (UXH-2), seconds after the banner computed the label from no
 * snapshot at all: the banner listens and computes it again, so it never keeps a count the device no longer holds
 * (accept-cu6 check 3). Memory only: the event carries no value, and nothing is fetched because of it.
 */
export const ZK_TICK_EVENT = "layers:zk-tick";
export function announceZkTick(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ZK_TICK_EVENT));
  } catch {
    /* no window (a server-side device, a worker, a test harness): nothing is listening */
  }
}

export function announceDevice(detail: DeviceEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<DeviceEventDetail>(DEVICE_EVENT, { detail }));
  } catch {
    /* no window (a worker, a test harness): nothing is listening */
  }
}

/**
 * The device could not start in this document. Idempotent: the first reason wins, and every call drains whatever
 * was queued since. A device that already INSTALLED is not failed — a later error is one route's, answered by it.
 */
export function markDeviceFailed(reason: string): void {
  const w = win();
  if (!w || w.__layersDeviceInstalled) return;
  const first = typeof w.__layersDeviceFailed !== "string";
  if (first) w.__layersDeviceFailed = String(reason || "unknown error").slice(0, 300);
  const why = w.__layersDeviceFailed as string;
  const queued = w.__layersFetchQueue ?? [];
  w.__layersFetchQueue = [];
  for (const q of queued) q.resolve(deviceFailedResponse(why));
  if (first) announceDevice({ state: "failed", reason: why });
}
