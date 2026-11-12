"use client";
// BROWSER KEYSTORE PASS Gate 6 (D-CU-0-3, realised at the app group: D-CU-6-THE-LANDING-IS-STATIC-AND-THE-APP-GROUP-
// IS-THE-DEVICE) — mounts the browser device on every page under app/(main). The root layout loads
// /device/boot.js BEFORE anything is interactive, so every same-origin /api/* fetch a client component makes on mount
// is queued; this component then declares the device environment the server handed it and loads the bundle, which
// boots the device and drains the queue. Nothing here reads a key — the server has none.
//
// PROD-LIVE (D-CU-0-4): the root layout now loads boot.js with next/script "beforeInteractive" (it runs before
// hydration on every document of a public deployment, however the visitor arrived). "Installed" is decided by what
// boot.js installs (window.__layersOrigFetch), never by a tag's presence — a tag React inserted during a soft
// navigation never runs (components/device/loadDevice.ts). If the bootstrap was missing, some island's on-mount read
// may already have reached the keyless server; once the device answers, one refresh() re-runs every island's read
// through it. The boot state is rendered by DeviceStatus: booting / slow (+ Retry) / failed (+ Retry) / ready
// (hidden). A loaded bundle that has not booted within 90 s (loadDevice.ts DEVICE_BOOT_DEADLINE_MS) is FAILED for
// this document — the queued reads drain with 503 — instead of pending forever behind a validator that never answers.
import { useEffect } from "react";
import { useApp } from "@/components/Providers";
import { DeviceStatus } from "./DeviceStatus";
import { startDevice } from "./loadDevice";

/** PROD-LIVE: set once this document is following a device that booted past the deadline (see the catch below) */
let watchingLateBoot = false;

export function DeviceHostMount({ env }: { env: Record<string, string> }) {
  const { refresh } = useApp();
  useEffect(() => {
    let alive = true;
    startDevice(env)
      .then(({ bootWasMissing }) => {
        if (alive && bootWasMissing) refresh();
      })
      .catch((e) => {
        // already VISIBLE: startDevice marked the document failed, DeviceStatus renders the reason and a Retry
        console.error("[device] the app page could not start the device: " + (e as Error).message);
        // PROD-LIVE: the 90 s boot deadline (loadDevice.ts) gives up on a device that may still be booting. If it
        // does boot after all, its host installs, DeviceStatus hides (bootState: installed wins over failed), and the
        // reads the deadline answered 503 are re-run through it here — instead of leaving every island on an error
        // for a device that now works. A device that truly failed (ready rejected, or never loaded) does nothing.
        // One watcher per document, and not tied to this effect run: an env change re-runs the effect (and clears
        // `alive`) without the device having booted, and the late boot must still be followed. refresh() after the
        // group unmounted is a no-op (Providers unmounted with it; on a public deployment refresh() is a tick only).
        const late = (window as unknown as { __layersDevice?: { ready?: Promise<unknown> } }).__layersDevice?.ready;
        if (late && !watchingLateBoot) {
          watchingLateBoot = true;
          late.then(
            () => refresh(),
            () => {}
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [env, refresh]);
  return <DeviceStatus />;
}
