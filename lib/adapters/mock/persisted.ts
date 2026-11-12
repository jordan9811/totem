import "server-only";
// Declarative write-through persistence. Rather than sprinkling flush calls
// through every mock adapter, each adapter is wrapped once with a map of
// mutating method → namespaces it dirties. The flush is awaited before the
// method resolves, so state that a caller was just told about is already
// durable — the restart-survival test depends on that ordering.
import { persistNs } from "./store";
import type { Namespace } from "./persist";

export function persisted<T extends object>(
  adapter: T,
  mutations: Partial<Record<keyof T & string, Namespace[]>>
): T {
  const cache = new Map<string, unknown>();
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      const namespaces = mutations[prop as keyof T & string];
      if (typeof original !== "function" || !namespaces) return original;
      if (cache.has(prop as string)) return cache.get(prop as string);
      const wrapped = async (...args: unknown[]) => {
        const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        for (const ns of namespaces) await persistNs(ns);
        return result;
      };
      cache.set(prop as string, wrapped);
      return wrapped;
    },
  }) as T;
}
