import "server-only";
// Controllable clock for everything time-driven in the mock layer: room
// liveness scripts and market auction timers. Tests jump it instead of
// waiting on wall-clock, which is what keeps countdown/bid-arrival specs
// deterministic (the gated-pass failure mode calls for exactly this).
import type { MarketClock } from "../types";

interface ClockState {
  offsetMs: number;
}

const g = globalThis as unknown as { __layersClock?: ClockState };
g.__layersClock ??= { offsetMs: 0 };

export const marketClock: MarketClock = {
  now() {
    return Date.now() + g.__layersClock!.offsetMs;
  },
  jumpTo(ms: number) {
    g.__layersClock!.offsetMs = ms - Date.now();
  },
  advance(ms: number) {
    g.__layersClock!.offsetMs += ms;
  },
  reset() {
    g.__layersClock!.offsetMs = 0;
  },
};

export function clockOffset(): number {
  return g.__layersClock!.offsetMs;
}
