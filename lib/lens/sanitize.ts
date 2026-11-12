// MEGA PASS 2 Gate 2 — the lens section's whitelist + guardrails. PURE:
// lib/algo/artifact.ts's sanitizer calls this for `kind: "lens"` artifacts
// and for packs that pin a lens. Unknown keys are stripped and REPORTED;
// the five protected surfaces are refused BY NAME and are FATAL to the
// import (an artifact that tried once is not one to run).
import { CANONICAL_CURVES, sanitizeCurves } from "@/lib/influence/curves";
import type { GuardrailViolation } from "@/lib/rules/evaluate";
import { LENS_PROTECTED_KEYS, LENS_SIGNALS, LENS_WEIGHT_MAX, LENS_WEIGHT_MIN, zeroSignals, type LensSignal, type LensSpec } from "./types";

export interface LensSanitizeResult {
  spec: LensSpec | null;
  violations: GuardrailViolation[];
  /** a protected surface was named — the whole import must die */
  fatal: boolean;
}

const CURVE_KEYS = new Set(["early", "confirmation", "pointsPerStewardship", "maxStewardshipPerEpoch", "coordination"]);

export function sanitizeLensSpec(raw: unknown): LensSanitizeResult {
  const violations: GuardrailViolation[] = [];
  let fatal = false;
  const l = raw as Record<string, unknown> | null;
  if (!l || typeof l !== "object") return { spec: null, violations: [{ where: "lens", field: "(root)", reason: "not an object" }], fatal: true };
  const refuseOrStrip = (where: string, k: string, stripReason: string) => {
    const hit = LENS_PROTECTED_KEYS.find(([re]) => re.test(k));
    if (hit) {
      violations.push({ where, field: k, reason: `attempts to reach ${hit[1]} — refused` });
      fatal = true;
    } else {
      violations.push({ where, field: k, reason: stripReason });
    }
  };
  for (const k of Object.keys(l)) {
    if (k === "signals" || k === "influenceDistribution") continue;
    refuseOrStrip("lens", k, "unknown lens field — stripped");
  }
  const signals = zeroSignals();
  const rawSignals = (l.signals ?? {}) as Record<string, unknown>;
  if (rawSignals && typeof rawSignals === "object") {
    for (const [k, v] of Object.entries(rawSignals)) {
      if (!(LENS_SIGNALS as readonly string[]).includes(k)) {
        refuseOrStrip("lens.signals", k, "not a canonical signal — stripped");
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v) || v < LENS_WEIGHT_MIN || v > LENS_WEIGHT_MAX) {
        violations.push({ where: "lens.signals", field: k, reason: `weight must be a number in ${LENS_WEIGHT_MIN}..${LENS_WEIGHT_MAX} — stripped` });
        continue;
      }
      signals[k as LensSignal] = v;
    }
  }
  const rawCurves = l.influenceDistribution as Record<string, unknown> | undefined;
  if (rawCurves && typeof rawCurves === "object") {
    for (const k of Object.keys(rawCurves)) {
      if (CURVE_KEYS.has(k)) continue;
      refuseOrStrip("lens.influenceDistribution", k, "unknown curve — stripped");
    }
  }
  const known = rawCurves && typeof rawCurves === "object" ? Object.fromEntries(Object.entries(rawCurves).filter(([k]) => CURVE_KEYS.has(k))) : undefined;
  const curves = known === undefined ? CANONICAL_CURVES : sanitizeCurves(known);
  if (!curves) {
    violations.push({ where: "lens", field: "influenceDistribution", reason: "malformed curve set — refused" });
    fatal = true;
  }
  if (fatal || !curves) return { spec: null, violations, fatal: true };
  return { spec: { signals, influenceDistribution: curves }, violations, fatal: false };
}
