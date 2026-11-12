// BROWSER KEYSTORE PASS Gate 1 stage 3 — `process` for the device bundle, injected by esbuild so every free
// `process` reference in the data layer resolves here. The environment is whatever the page declared on
// `globalThis.__LAYERS_DEVICE_ENV` BEFORE the bundle loaded (the modules read `process.env.*` at import time).
// Production-shaped by default: NODE_ENV=production, no dev hooks, no write flags — the page can only add what the
// server would have set.
type Env = Record<string, string | undefined>;

const declared = ((globalThis as unknown as { __LAYERS_DEVICE_ENV?: Env }).__LAYERS_DEVICE_ENV ?? {}) as Env;
const env: Env = { NODE_ENV: "production", ...declared };

export const process = {
  env,
  cwd: () => "/",
  platform: "browser",
  arch: "wasm",
  version: "v0.0.0-browser-device",
  versions: {} as Record<string, string>,
  argv: [] as string[],
  pid: 0,
  title: "layers-device",
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  hrtime: Object.assign(
    (prev?: [number, number]): [number, number] => {
      const ms = performance.now();
      const s = Math.floor(ms / 1000);
      const ns = Math.floor((ms - s * 1000) * 1e6);
      return prev ? [s - prev[0], ns - prev[1]] : [s, ns];
    },
    { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }
  ),
  uptime: () => performance.now() / 1000,
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
  on: () => process,
  once: () => process,
  off: () => process,
  emit: () => false,
  emitWarning: (w: unknown) => console.warn(w),
  exit: (code?: number): never => {
    throw new Error(`process.exit(${code ?? 0}) called in the browser device`);
  },
  stdout: { write: (s: string) => (console.log(s), true), isTTY: false },
  stderr: { write: (s: string) => (console.error(s), true), isTTY: false },
};
