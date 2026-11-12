"use client";
// PROD-LIVE (D-CU-0-4) — the device's boot state, visible. Mounted by DeviceHostMount, so only on a public deployment
// (the rig's server answers /api/* itself and has no device to wait for).
//
//   booting  a small pill while the device starts ("Starting your device…")
//   slow     the same pill after ~20 s, saying why it can take a while, WITH a Retry (below)
//   failed   the reason and a Retry. A FULL reload is right here (and in "slow"): the identity already failed to
//            start, so there is nothing in this tab's memory for a reload to lose
//   ready    nothing visible; the element stays (hidden) so a test can read data-state="ready"
//
// The state comes from lib/device/bootState.ts: window flags for "already happened" (a status that mounts after the
// device booted, e.g. on a soft navigation back into the app) and the `layers:device` event for "happening now".
// Before this, a boot failure was a console.error and the page spun forever.
//
// PROD-LIVE: "slow" used to be a dead end — a validator that accepted the connection and never answered left the pill
// spinning with no way out. Now (a) loadDevice.ts fails the boot 90 s after the bundle has run, which lands here as
// "failed" + Retry, and (b) "slow" offers the same Retry before that. A reload there loses nothing either: the
// identity has not started, so there is nothing in tab memory yet (a saved one is restored by the reload). And the
// "downloads about 3 MB" explanation is only true while the bundle is still downloading — once device.js has RUN
// (window.__layersDevice exists) the wait is the boot itself, and the pill says so instead.
import { useEffect, useState } from "react";
import { DEVICE_EVENT, deviceBootState } from "@/lib/device/bootState";

type Shown = "booting" | "slow" | "ready" | "failed";

const SLOW_MS = 20_000;

/** true once the device bundle has run in this document (it sets window.__layersDevice as it evaluates) */
function bundleLoaded(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __layersDevice?: unknown }).__layersDevice;
}

function RetryButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      data-testid="device-retry"
      onClick={() => window.location.reload()}
      className={
        compact
          ? "pointer-events-auto h-7 shrink-0 rounded-full bg-x-blue px-3 text-[13px] font-bold text-white"
          : "mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white"
      }
    >
      Retry
    </button>
  );
}

export function DeviceStatus() {
  const [state, setState] = useState<Shown>("booting");
  const [reason, setReason] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sync = () => {
      const s = deviceBootState();
      if (s.state === "ready") {
        setState("ready");
        setReason(null);
      } else if (s.state === "failed") {
        setState("failed");
        setReason(s.reason);
      }
    };
    sync();
    window.addEventListener(DEVICE_EVENT, sync);
    const slow = window.setTimeout(() => setState((cur) => (cur === "booting" ? "slow" : cur)), SLOW_MS);
    return () => {
      window.removeEventListener(DEVICE_EVENT, sync);
      window.clearTimeout(slow);
    };
  }, []);

  // whether the bundle is still downloading: polled only while the pill is showing (it is gone once ready/failed)
  const waiting = state === "booting" || state === "slow";
  useEffect(() => {
    if (!waiting) return;
    setLoaded(bundleLoaded());
    const t = window.setInterval(() => setLoaded(bundleLoaded()), 1000);
    return () => window.clearInterval(t);
  }, [waiting]);

  if (state === "ready") return <div data-testid="device-status" data-state="ready" hidden />;

  if (state === "failed") {
    return (
      <div
        data-testid="device-status"
        data-state="failed"
        role="alert"
        className="fixed left-1/2 top-2 z-[90] w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl border border-[#fdc9ce] bg-white p-3 text-[14px] leading-5 shadow-[0_0_15px_rgba(101,119,134,0.2)]"
      >
        <p className="font-bold text-[#f4212e]">Your device failed to start.</p>
        <p className="mt-1 break-words text-x-sec" data-testid="device-status-reason">
          {reason || "unknown error"}
        </p>
        <p className="mt-1 text-x-sec">Nothing on this page can be read or written until it starts. Retry reloads the page and starts the device again.</p>
        <RetryButton />
      </div>
    );
  }

  const label =
    state === "slow"
      ? loaded
        ? "Still starting your device — this is taking longer than usual"
        : "Still starting your device — the first load downloads about 3 MB"
      : "Starting your device…";
  return (
    <div
      data-testid="device-status"
      data-state={state}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-2 z-[90] flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-full border border-x-border bg-white/95 px-3 py-1.5 text-[13px] font-bold leading-4 text-x-sec shadow-sm"
    >
      <span aria-hidden className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
      <span>{label}</span>
      {/* the pill never blocks the page beneath it; only its button takes the click */}
      {state === "slow" ? <RetryButton compact /> : null}
    </div>
  );
}
