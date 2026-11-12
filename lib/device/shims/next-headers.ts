// BROWSER KEYSTORE PASS Gate 1 stage 3 — `next/headers` for the device bundle. cookies() is the device jar; there
// is no request scope because the browser is one visitor. headers() is empty: nothing in the device reads one.
import { deviceJar } from "@/lib/device/jar";

export function cookies() {
  return {
    get: (name: string) => {
      const v = deviceJar.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
    getAll: () => deviceJar.entries().map(([name, value]) => ({ name, value })),
    has: (name: string) => deviceJar.has(name),
    set: (name: string, value: string) => {
      deviceJar.set(name, value);
    },
    delete: (name: string) => {
      deviceJar.delete(name);
    },
  };
}

export function headers(): Headers {
  return new Headers();
}
