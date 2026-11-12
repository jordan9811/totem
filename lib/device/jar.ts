// BROWSER KEYSTORE PASS Gate 1 stage 3 — the device's cookie jar. In the browser the route handlers run in-process,
// so "cookies" are whatever the device remembers between its own requests: one visitor, one jar, no request scope.
// The Next shims (next/headers, next/server) read and write this; the rig never loads it.
const jar = new Map<string, string>();

export const deviceJar = {
  get: (name: string): string | undefined => jar.get(name),
  has: (name: string): boolean => jar.has(name),
  set: (name: string, value: string): void => {
    jar.set(name, value);
  },
  delete: (name: string): void => {
    jar.delete(name);
  },
  entries: (): [string, string][] => [...jar.entries()],
  clear: (): void => jar.clear(),
};
