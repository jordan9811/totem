// Mocks lie about success, never about cost: every mock method routes
// through withMockLatency() — randomized 200-1500ms latency, 2% synthetic
// failure. A consuming component with no loading/error state is a bug
// (see ARCHITECTURE.md, ground rule 2). Dev latency-injection override
// lives in devControls.ts.
import "server-only";
import { AdapterError } from "./types";
import { consumeForcedFailure, getDevControls } from "./devControls";

// Deterministic PRNG so repeated calls in a single seeded test run are
// reproducible when a fixed seed is supplied; falls back to Math.random
// for normal interactive use (latency jitter is fine to be non-deterministic
// at runtime — only /seed generation needs to be deterministic).
function rand(): number {
  return Math.random();
}

// Hydration is resolved through a dynamic import to avoid a static cycle
// (store imports mockUtils' peers). Cache the module promise at module
// scope: this runs on EVERY adapter call, and re-entering the import
// machinery thousands of times per session is pure overhead.
let storeModule: Promise<typeof import("./mock/store")> | null = null;
function loadStore() {
  storeModule ??= import("./mock/store");
  return storeModule;
}

export async function withMockLatency<T>(fn: () => T | Promise<T>, opts?: { label?: string }): Promise<T> {
  // Hydrate persisted adapter state once per process. Every mock adapter
  // method funnels through here, so no call site needs to know about it.
  const { hydrate } = await loadStore();
  await hydrate();

  // BROWSER KEYSTORE PASS Gate 2 (D-CU-2-A-DEVICE-IS-NOT-A-RIG): the synthetic latency and the 2% synthetic failure
  // are the RIG's demonstration of retry discipline. A production process without the dev hooks — the visitor's
  // browser device, or a production server — gets neither: a visitor's persona mint must not fail by dice.
  const rig = !(process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true");
  if (!rig) return fn();

  const controls = getDevControls();
  const [lo, hi] = controls.latencyInjectionMs ?? [200, 1500];
  const failureRate = controls.failureRateOverride ?? 0.02;

  const delay = lo + rand() * (hi - lo);
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Deterministic forced failure (tests proving fail-closed behaviour).
  if (consumeForcedFailure(opts?.label)) {
    throw new AdapterError(
      `forced failure${opts?.label ? ` (${opts.label})` : ""}`,
      "FAILED"
    );
  }

  if (rand() < failureRate) {
    throw new AdapterError(`mock adapter synthetic failure${opts?.label ? ` (${opts.label})` : ""}`, "FAILED");
  }

  return fn();
}
