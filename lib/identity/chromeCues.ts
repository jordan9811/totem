// PROD-LIVE (D-CU-0-4) — the two PURE chrome cues, client-safe.
//
// lib/identity/chrome.ts is `server-only` (it reads the sealed personaChrome vault record), so a client island cannot
// import washOf / modeEdgeOf from it. On a public deployment the server has no identity and cannot compute the chrome
// at all: components/ChromeRoot.tsx reads /api/persona/chrome and /api/modes through the browser device and derives
// the wash and the mode edge HERE. These are byte-for-byte copies of the helpers in chrome.ts (POST-DEPLOY Gate 2);
// the rig never uses them for its server render — the layout hands the island the values chrome.ts computed — so a
// drift here cannot move a rig suite, and accept-pd2.mjs recomputes modeEdgeOf independently either way.

/** the default accent when a colour is malformed — TINT_PALETTE[0] in chrome.ts */
const DEFAULT_TINT = "#1d9bf0";
const HEX = /^#[0-9a-f]{6}$/i;

export function isTint(color: unknown): color is string {
  return typeof color === "string" && HEX.test(color);
}

/** the translucent wash painted on chrome surfaces (chrome.ts washOf) */
export function washOf(color: string, alpha = 0.08): string {
  const c = HEX.test(color) ? color : DEFAULT_TINT;
  const r = parseInt(c.slice(1, 3), 16);
  const gg = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return "rgba(" + r + ", " + gg + ", " + b + ", " + alpha + ")";
}

/** the MODE signal: a border treatment, a second channel beside the persona colour (chrome.ts modeEdgeOf) */
export const MODE_EDGES = ["solid", "dashed", "dotted", "double"] as const;
export type ModeEdge = (typeof MODE_EDGES)[number];

export function modeEdgeOf(modeId: string | null | undefined): ModeEdge {
  if (!modeId) return "solid";
  let h = 0;
  for (let i = 0; i < modeId.length; i++) h = (h * 31 + modeId.charCodeAt(i)) >>> 0;
  return MODE_EDGES[h % MODE_EDGES.length];
}
