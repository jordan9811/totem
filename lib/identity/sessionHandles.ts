import "server-only";
import { fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
// Opaque browser session handles.
//
// v2 put the raw rootId in a cookie. A cookie is an outward payload, so that
// is root material leaving the keystore — exactly what the leak test
// forbids. The browser now holds a one-way handle; the handle→root mapping
// lives server-side only.
import { createHash } from "@/lib/platform/crypto";

const BASE = validatorUrl();
const NS = "sessionHandles";

const g = globalThis as unknown as { __layersSessionHandles?: Map<string, string> };
g.__layersSessionHandles ??= new Map();

export function handleFor(rootId: string): string {
  return createHash("sha256").update(rootId).update(":session").digest("hex").slice(0, 24);
}

async function loadAll(): Promise<Map<string, string>> {
  if (g.__layersSessionHandles!.size > 0) return g.__layersSessionHandles!;
  try {
    const res = await fetchState(NS);
    if (res.ok) {
      const { entries } = await res.json();
      // The handle→rootId map is a session-deanonymization table — recon
      // flagged it as plaintext on the untrusted server that the leak
      // grep even missed. It is vaulted: stored as ciphertext, decrypted
      // here (fail-closed per record, wrong key throws).
      const { decryptNamespace } = await import("@/lib/vault/vault");
      const sealed = decryptNamespace(NS, entries ?? {});
      // ZK PASS 2 Gate 4 (attack-z2-1 #6): ONE opaque record — the handle
      // keys were sha256(rootId) prefixes, invertible over the roots table
      const rec = sealed["_"] as { m?: Record<string, unknown> } | undefined;
      const plain = rec && typeof rec === "object" && rec.m && typeof rec.m === "object" ? rec.m : sealed;
      for (const [k, v] of Object.entries(plain)) {
        g.__layersSessionHandles!.set(k, String(v));
      }
    }
  } catch {
    /* validator down — handles resolve from memory only this process */
  }
  return g.__layersSessionHandles!;
}

export async function registerHandle(rootId: string): Promise<string> {
  const handle = handleFor(rootId);
  const map = await loadAll();
  map.set(handle, rootId);
  try {
    // Vaulted + signed: encrypt the map (the server stores ciphertext
    // only), then through the persist client so the device envelope is
    // attached under LAYERS_REQUIRE_SIG — a silently-refused session
    // write would strand every new session at "who are you?".
    const { flush } = await import("@/lib/adapters/mock/persist");
    const { encryptNamespace } = await import("@/lib/vault/vault");
    const inner = JSON.stringify(Object.fromEntries(map));
    const target = 1024 * Math.ceil((inner.length + 64) / 1024);
    await flush(NS, encryptNamespace(NS, { _: { m: Object.fromEntries(map), pad: " ".repeat(Math.max(0, target - inner.length - 48)) } }));
  } catch {
    /* best effort; the in-process map still serves this session */
  }
  return handle;
}

/** Resolve a browser handle back to the server-internal root id. */
export async function rootForHandle(handle: string): Promise<string | null> {
  const map = await loadAll();
  return map.get(handle) ?? null;
}


/**
 * GATE 5 (attack-post-3 F-11): the handle -> root table is cached here with no reset, so a
 * seed reset left it populated and the next write resurrected the wiped mapping.
 */
export function resetSessionHandlesCache(): void {
  g.__layersSessionHandles = new Map();
}
