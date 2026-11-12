// ADS, PHASE 1 — THE SWITCH: Phase 1 ships DORMANT. Nobody can buy a slot yet, so the house ad must not reach real
// visitors until the owner turns ads on (docs/technical/env.md; notes/runbooks/OWNER-CHECKLIST.md, "Turn ads on").
//
// Where it is read, and what it means there:
//   - THE PUBLIC APP SERVER: ADS=on turns ads on. Unset, empty or "off" leaves them off. ANY OTHER VALUE is off too (the
//     safe side: a typo never starts ads), said once at boot by NAME and a length class, never the value
//     (instrumentation.ts).
//   - THE VISITOR'S BROWSER DEVICE: the device env value ADS === "on". lib/device/deviceEnv.server.ts forwards it only
//     when the server's own value is on (adsDeviceHints below; off forwards NOTHING, so a page is byte for byte what it
//     was). A page script that sets it on in its own tab only shows itself the house ads it could read at /ads/lots.json
//     anyway: it grants nothing.
// OFF: the plan (lib/ads/plan.ts) places no ad on any feed and says "Ads aren't running on Totem yet."; the per-mode dial
// in Settings, Modes stays editable with that line beside it; the lot list is still served read-only. ON: Phase 1.
//
// This file imports NOTHING (the instrumentation hook and the device env builder both read it).

type Env = Record<string, string | undefined>;

export const ADS_ENV = "ADS";
export const ADS_DEVICE_VALUE = "on";
export const ADS_DORMANT_SENTENCE = "Ads aren't running on Totem yet.";

/** the server variable's value class: "on", "off" (unset, empty, "off"), or "invalid" (anything else: read as off) */
export function adsSwitchValue(env: Env): "on" | "off" | "invalid" {
  const v = String(env[ADS_ENV] ?? "").trim().toLowerCase();
  if (v === "on") return "on";
  if (v === "" || v === "off") return "off";
  return "invalid";
}

/** what the browser device is told: ADS=on only while the server's own switch is on; nothing otherwise */
export function adsDeviceHints(env: Env): Record<string, string> {
  return adsSwitchValue(env) === "on" ? { [ADS_ENV]: ADS_DEVICE_VALUE } : {};
}

function processEnv(): Env {
  try {
    return (typeof process !== "undefined" && process.env ? process.env : {}) as Env;
  } catch {
    return {};
  }
}

/** are ads running HERE? The device: the env the server handed it says ADS=on. A server: its own ADS=on. */
export function adsRunning(env: Env = processEnv()): boolean {
  if (typeof window !== "undefined") return (env[ADS_ENV] ?? "") === ADS_DEVICE_VALUE;
  return adsSwitchValue(env) === "on";
}

/** the boot line for an unusable value (names and a length class only), or null */
export function adsBootWarning(env: Env): string | null {
  if (adsSwitchValue(env) !== "invalid") return null;
  return `ADS must be "on", "off" or unset (got a value of ${String(env[ADS_ENV]).length} character(s)); ads stay OFF`;
}
