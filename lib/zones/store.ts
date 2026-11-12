import "server-only";
// MEGA PASS 2 Gate 3 — SCROLL ZONES, stored. Per-DEVICE and private: one
// opaque padded sealed vault record (`scrollZones`) keyed by this device's
// auth public key. The validator learns nothing about how a screen is
// carved up; a zone config is a fingerprint of a hand and a habit, and it
// stays in the vault like every other device-specific preference.
//
// Saves go through the SAME validation the API exposes: a malformed config
// is refused with the field named; a reading zone that enters the OS
// edge-gesture band is refused with the edge named. Fail-closed reads,
// like every sealed record.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import { deviceAuthPublicKey } from "@/lib/identity/keystore";
import { DEFAULT_ZONE_CONFIG, edgeViolations, sanitizeZoneConfig, type ZoneConfig, type ZoneViolation } from "./types";

export const VAULT_NS = "scrollZones";

interface Doc {
  devices: Record<string, ZoneConfig>;
  loaded: boolean;
}
const g = globalThis as unknown as { __layersScrollZones?: Doc };

async function load(): Promise<Doc> {
  if (g.__layersScrollZones) return g.__layersScrollZones;
  let doc: Doc = { devices: {}, loaded: false };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) { doc.loaded = true; break; }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries);
        const rec = plain["_"] as { m?: { devices?: Record<string, ZoneConfig> } } | undefined;
        // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
        // namespace whose records are all unreadable — deleted, truncated, plaintext, or
        // sealed under a different key — became an EMPTY document marked loaded, and the next
        // write sealed that emptiness over the real record. Records present with none readable
        // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
        if (!rec)
          throw new Error(
            "vault: scrollZones holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        doc = { devices: rec?.m?.devices && typeof rec.m.devices === "object" ? rec.m.devices : {}, loaded: true };
      } else {
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!doc.loaded) throw new Error("scroll zones unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty");
  g.__layersScrollZones = doc;
  return doc;
}

async function save(doc: Doc): Promise<void> {
  if (!doc.loaded) throw new Error("scroll zones were never loaded from the validator — refusing to seal over them");
  g.__layersScrollZones = doc;
  const inner = JSON.stringify(doc.devices);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: { devices: doc.devices }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  await flushVault(VAULT_NS, sealed);
}

export function resetZonesCache(): void {
  g.__layersScrollZones = undefined;
}

/** this device's key — public material (the device-auth pubkey); a short fingerprint is what the UI shows */
export function thisDeviceKey(): string {
  return deviceAuthPublicKey();
}

export async function zoneConfigForThisDevice(): Promise<{ config: ZoneConfig; saved: boolean }> {
  const doc = await load();
  const c = doc.devices[thisDeviceKey()];
  return c ? { config: c, saved: true } : { config: { ...DEFAULT_ZONE_CONFIG, zones: [] }, saved: false };
}

export type SaveZonesResult = { ok: true; config: ZoneConfig } | { ok: false; code: "malformed" | "edge"; reason: string; violations?: ZoneViolation[] };

export async function saveZoneConfigForThisDevice(raw: unknown): Promise<SaveZonesResult> {
  const { config, reason } = sanitizeZoneConfig(raw);
  if (!config) return { ok: false, code: "malformed", reason: reason ?? "malformed" };
  const violations = edgeViolations(config);
  if (violations.length) return { ok: false, code: "edge", reason: "a reading zone overlaps the OS edge-gesture band: " + violations.map((v) => v.edge).join(", "), violations };
  const doc = await load();
  const saved: ZoneConfig = { ...config, savedAt: Date.now() };
  doc.devices[thisDeviceKey()] = saved;
  await save(doc);
  return { ok: true, config: saved };
}
