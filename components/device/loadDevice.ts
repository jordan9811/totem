// PROD-LIVE (D-CU-0-4) — loading the browser device into THIS document, shared by the app group's mount
// (DeviceHostMount) and the device's own page (DeviceApp).
//
// Two traps this closes, both of which left the page talking to a keyless server or spinning forever:
//   1. "Is the early bootstrap installed?" was answered by "does a <script src=/device/boot.js> exist?". After a SOFT
//      navigation that tag can be one React inserted during client rendering — React never executes those — so the
//      tag existed, the fetch queue did not, and every /api/* read made on mount went to the server. The answer is now
//      the thing boot.js actually installs: window.__layersOrigFetch. If it is missing the script is injected again
//      and AWAITED (boot.js guards against double installation itself).
//   2. "Is the bundle loaded?" was the same tag test, so a second mount resolved at once and read
//      window.__layersDevice before the module had run. Now: the device object if it exists; otherwise the tag this
//      loader injected (tracked by data-layers-state), or an existing one, is waited on until it runs or errors.
// A download or start failure is marked on the document (lib/device/bootState.ts markDeviceFailed): queued requests
// are answered 503 and DeviceStatus says so, instead of an infinite spinner.
import { markDeviceFailed } from "@/lib/device/bootState";

export interface LoadedDevice {
  ready: Promise<unknown>;
  info?: unknown;
}
interface LoaderWindow {
  __LAYERS_DEVICE_ENV?: Record<string, string>;
  __layersOrigFetch?: unknown;
  __layersDevice?: LoadedDevice;
}

const BOOT_SRC = "/device/boot.js";
const DEVICE_SRC = "/device/device.js";

const w = () => window as unknown as LoaderWindow;

function inject(src: string, type?: string): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    if (type) s.type = type;
    s.dataset.layersState = "loading";
    s.onload = () => {
      s.dataset.layersState = "loaded";
      resolve(s);
    };
    s.onerror = () => {
      s.dataset.layersState = "error";
      reject(new Error("could not download " + src));
    };
    document.head.appendChild(s);
  });
}

/** true when boot.js was NOT installed and had to be loaded here (some on-mount read may have missed the queue) */
async function ensureBootstrap(): Promise<boolean> {
  if (w().__layersOrigFetch) return false;
  await inject(BOOT_SRC);
  if (!w().__layersOrigFetch) throw new Error("the early bootstrap (" + BOOT_SRC + ") loaded but did not install");
  return true;
}

function waitForDeviceObject(el: HTMLScriptElement | null): Promise<LoadedDevice> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const d = w().__layersDevice;
      if (d) {
        done();
        resolve(d);
        return true;
      }
      const state = el?.dataset.layersState;
      if (state === "error") {
        done();
        reject(new Error("could not download " + DEVICE_SRC));
        return true;
      }
      if (state === "loaded") {
        done();
        reject(new Error("the device bundle loaded but did not start"));
        return true;
      }
      return false;
    };
    const onError = () => {
      done();
      reject(new Error("could not download " + DEVICE_SRC));
    };
    const timer = window.setInterval(check, 100);
    const done = () => {
      window.clearInterval(timer);
      el?.removeEventListener("error", onError);
    };
    el?.addEventListener("error", onError);
    check();
  });
}

async function ensureBundle(): Promise<LoadedDevice> {
  const existing = w().__layersDevice;
  if (existing) return existing;
  const tag = document.querySelector<HTMLScriptElement>(`script[src="${DEVICE_SRC}"]`);
  if (!tag) {
    await inject(DEVICE_SRC, "module"); // a module script's load event fires after it has run
    const d = w().__layersDevice;
    if (!d) throw new Error("the device bundle loaded but did not start");
    return d;
  }
  // a tag another mount injected: wait for it to run (no timeout — a slow first download is DeviceStatus's "slow")
  return waitForDeviceObject(tag);
}

/**
 * PROD-LIVE: how long a LOADED bundle may take to boot before this document calls it failed. device.ready had no
 * deadline, so a validator that accepts the connection and never answers (a wedged process, a proxy holding the
 * socket) left it pending forever: every queued /api/* read hung and DeviceStatus sat on "slow" with no way out.
 * The clock starts once the bundle has RUN (a slow 3 MB download is not a boot failure), and 90 s is far past a
 * healthy cold boot (a few seconds; the acceptance suites allow 150 s only for a machine running a dozen servers).
 */
export const DEVICE_BOOT_DEADLINE_MS = 90_000;
const DEADLINE_REASON = "the device did not start within " + Math.round(DEVICE_BOOT_DEADLINE_MS / 1000) + " s";

function withDeadline<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(reason)), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Load boot.js (if this document lacks it) and the device bundle, and wait for the device to boot — at most
 * DEVICE_BOOT_DEADLINE_MS once the bundle has run; past that the document is marked failed (queued reads drain with
 * 503, DeviceStatus shows the reason and a Retry). A device that still boots after that is not lost: bootState's
 * "installed wins" makes DeviceStatus hide again, and DeviceHostMount re-runs every island's read.
 * `env` is the device environment the SERVER handed the page; the bundle reads it once, at load.
 */
export async function startDevice(
  env: Record<string, string>,
  opts: { overwriteEnv?: boolean } = {}
): Promise<{ device: LoadedDevice; bootWasMissing: boolean }> {
  try {
    if (opts.overwriteEnv || !w().__LAYERS_DEVICE_ENV) w().__LAYERS_DEVICE_ENV = env;
    const bootWasMissing = await ensureBootstrap();
    const device = await ensureBundle();
    await withDeadline(device.ready, DEVICE_BOOT_DEADLINE_MS, DEADLINE_REASON);
    return { device, bootWasMissing };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    markDeviceFailed(reason); // idempotent; entry.ts already marked a boot() rejection
    throw e instanceof Error ? e : new Error(reason);
  }
}
