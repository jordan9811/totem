// DIAGRAMS: shared geometry and the status vocabulary.
//
// Every picture on the docs site is inline SVG drawn by a Vue component in this folder, so it inherits the page's
// colours (VitePress variables and currentColor) and follows the light/dark switch. An <img src="x.svg"> cannot: it
// is a separate document that never sees the page's .dark class. The docs build reads these; the app's own code never
// does (D-CU-6: nothing under docs/ enters the Next bundle). DOCS UNDER APP: `npm run build` now builds this site
// beside the app (scripts/build-docs.mjs into .docs-site/) and the app serves the result at /docs as static files.

export type Pt = [number, number];

/** The six states a reader sees, worded exactly as the status legend on the docs pages. */
export const STATUS = {
  live: "Works live",
  test: "Built, test data only",
  designed: "Designed",
  off: "Off on purpose",
  soon: "Coming soon",
  na: "Not offered here",
} as const;
export type Status = keyof typeof STATUS;

/** A pill wide enough for its label at 12px semibold, with room to spare: the text is centred, so spare width is padding. */
export const chipWidth = (label: string): number => Math.round(label.length * 6.6 + 22);

/** Pull `to` back towards `from` by `by` units, so a line ends under its arrowhead instead of poking through the tip. */
export function pullBack(from: Pt, to: Pt, by: number): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [to[0] - (dx / len) * by, to[1] - (dy / len) * by];
}

/** The three corners of an arrowhead whose tip sits on `to`, pointing away from `from`. */
export function arrowHead(from: Pt, to: Pt, size = 9): string {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const half = size * 0.55;
  const bx = to[0] - size * Math.cos(a);
  const by = to[1] - size * Math.sin(a);
  const corners: Pt[] = [to, [bx + half * Math.sin(a), by - half * Math.cos(a)], [bx - half * Math.sin(a), by + half * Math.cos(a)]];
  return corners.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}
