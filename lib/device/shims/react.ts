// BROWSER KEYSTORE PASS Gate 1 stage 3 — `react` for the device bundle: the only React the data layer uses is
// `cache()` (per-render memoisation for server components). The device has no render; the function is itself.
export function cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
