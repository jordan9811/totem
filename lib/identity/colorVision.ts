// POST-DEPLOY Gate 2 — COLOUR VISION, as arithmetic.
//
// The persona tint exists so that a glance is enough. A glance is not enough
// if two personas' accents land on the same point for the person glancing, so
// "are these two far enough apart" has to be a computation, not an opinion.
//
// Dichromat simulation: Viénot–Brettel–Mollon, applied in LINEAR sRGB (the
// matrices are defined there; applying them to gamma-encoded bytes, which is
// the common shortcut, shifts the answer enough to matter near the threshold).
// Distance: CIE76 dE in L*a*b*. CIE76 is the crude one — it over-weights
// saturation differences — but it is conservative in the direction that
// matters here: it never reports two colours as FARTHER apart than a better
// metric would by much, and the threshold is set with that slack in mind.
//
// The Gate 2 suite carries its own independent copy of this arithmetic on
// purpose: a suite that imports the implementation it is checking only proves
// the implementation equals itself.

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

const hexToRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

export const VISION_MODELS = ["normal", "deuteranopia", "protanopia", "tritanopia"] as const;
export type VisionModel = (typeof VISION_MODELS)[number];

// GATE 5 (attack-post-3 F-3): the deuteranopia row was WRONG in two places — 0.7 where the
// Vienot matrix has 0.375, and an identity blue row instead of [0, 0.3, 0.7]. The effect was
// that the red-green axis did not collapse at all, so the simulation reported colours as far
// apart under deuteranopia that a deuteranope cannot separate: a violet and the product blue
// measured 12.4 when the correct matrix gives 4.1, and setTint would have ACCEPTED that pair.
// The Gate 2 suite carried a copy-pasted copy of the same mistake, which is the honest limit
// of "an independent implementation" — independent code is not independent arithmetic. Both
// are corrected, and the shipped palette was re-measured against the corrected matrices.
const SIM: Record<VisionModel, number[][]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  protanopia: [[0.56667, 0.43333, 0], [0.55833, 0.44167, 0], [0, 0.24167, 0.75833]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.43333, 0.56667], [0, 0.475, 0.525]],
};

function simulate(hex: string, model: VisionModel): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const m = SIM[model];
  return [
    linearToSrgb(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    linearToSrgb(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    linearToSrgb(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ];
}

function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const X = (0.4124 * srgbToLinear(r) + 0.3576 * srgbToLinear(g) + 0.1805 * srgbToLinear(b)) / 0.95047;
  const Y = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  const Z = (0.0193 * srgbToLinear(r) + 0.1192 * srgbToLinear(g) + 0.9505 * srgbToLinear(b)) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** The WORST separation between two colours across every vision model — the one
 *  that decides whether somebody can tell them apart. */
export function separation(a: string, b: string): { distance: number; model: VisionModel } {
  let worst: { distance: number; model: VisionModel } = { distance: Infinity, model: "normal" };
  for (const model of VISION_MODELS) {
    const [la, aa, ba] = toLab(simulate(a, model));
    const [lb, ab, bb] = toLab(simulate(b, model));
    const d = Math.hypot(la - lb, aa - ab, ba - bb);
    if (d < worst.distance) worst = { distance: d, model };
  }
  return worst;
}

/** CIE76 dE below this is a coin flip on adjacent chrome. The palette holds ~15. */
export const MIN_SEPARATION = 12;
