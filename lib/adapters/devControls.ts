// Process-lifetime dev controls: latency injection override + failure rate
// override, toggled from the Developer settings pane. Not persisted to
// disk — resets on server restart, which is fine for a dev tool.
import "server-only";

interface DevControls {
  latencyInjectionMs: [number, number] | null;
  failureRateOverride: number | null;
  /** force the next N calls whose label matches to fail, deterministically */
  forceFail: { label: string; remaining: number } | null;
  /** FC Gate 2: force the next N live Neynar fetches to see a synthetic
   * 429 — the rate-limit degrade path has to be provable, not probable */
  forceNeynar429: { remaining: number } | null;
  /** FC Gate 3: drop the RESPONSE of the next N fixture publishes AFTER
   * the commit — the ambiguous mid-publish kill the retry test needs */
  forceFcPublishDrop: { remaining: number } | null;
}

const g = globalThis as unknown as { __layersDevControls?: DevControls };
g.__layersDevControls ??= {
  latencyInjectionMs: null,
  failureRateOverride: null,
  forceFail: null,
  forceNeynar429: null,
  forceFcPublishDrop: null,
};
// self-heal across hot reloads: a controls object created before a newer
// knob existed would read undefined and never disarm cleanly
g.__layersDevControls.forceNeynar429 ??= null;
g.__layersDevControls.forceFcPublishDrop ??= null;

export function getDevControls(): DevControls {
  return g.__layersDevControls!;
}

export function setLatencyInjection(range: [number, number] | null) {
  g.__layersDevControls!.latencyInjectionMs = range;
}

export function setFailureRateOverride(rate: number | null) {
  g.__layersDevControls!.failureRateOverride = rate;
}

/** Developer pane "max out latency injection" toggle: fixed 1400-1500ms, 25% failure. */
export function maxOutLatencyInjection(on: boolean) {
  setLatencyInjection(on ? [1400, 1500] : null);
  setFailureRateOverride(on ? 0.25 : null);
}

/**
 * Force the next `count` adapter calls with a matching label to fail.
 * Random 25% injection makes fail-closed paths only *probably* exercised;
 * the fail-closed set has to be provable, so tests use this instead.
 */
export function forceFailNext(label: string, count: number) {
  g.__layersDevControls!.forceFail = count > 0 ? { label, remaining: count } : null;
}

/** FC Gate 2: arm N synthetic 429s on the live Neynar transport. */
export function forceNeynar429(count: number) {
  g.__layersDevControls!.forceNeynar429 = count > 0 ? { remaining: count } : null;
}

/** Consumed by the Neynar fetch layer; decrements and reports whether to 429. */
export function consumeForced429(): boolean {
  const f = g.__layersDevControls!.forceNeynar429;
  if (!f) return false;
  f.remaining -= 1;
  if (f.remaining <= 0) g.__layersDevControls!.forceNeynar429 = null;
  return true;
}

/** FC Gate 3: arm N post-commit response drops on the fixture publish. */
export function forceFcPublishDrop(count: number) {
  g.__layersDevControls!.forceFcPublishDrop = count > 0 ? { remaining: count } : null;
}

/** Consumed by the fixture FC transport after commit, before responding. */
export function consumeFcPublishDrop(): boolean {
  const f = g.__layersDevControls!.forceFcPublishDrop;
  if (!f) return false;
  f.remaining -= 1;
  if (f.remaining <= 0) g.__layersDevControls!.forceFcPublishDrop = null;
  return true;
}

/** Consumed by withMockLatency; decrements and reports whether to fail. */
export function consumeForcedFailure(label: string | undefined): boolean {
  const ff = g.__layersDevControls!.forceFail;
  if (!ff || !label || !label.includes(ff.label)) return false;
  ff.remaining -= 1;
  if (ff.remaining <= 0) g.__layersDevControls!.forceFail = null;
  return true;
}
