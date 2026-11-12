// PUBLIC GO-LIVE — A PERSONA'S DEFAULT PICTURE, MADE ON THE DEVICE.
//
// The old default avatar was an <img> from api.dicebear.com: every visitor's browser asked a third-party host for a
// picture named after the persona's handle, so that host learned "address X has a persona called @y" (a handle is the
// seed in the URL). This draws the picture locally instead: a small symmetric 5 x 5 pattern on a coloured disc, as an
// inline SVG data URI (components/CastCard.tsx mediaHostAllowed already loads data: URIs directly), so showing it
// makes NO request to anyone.
//
// Deterministic: the same seed always gives the same picture (FNV-1a over the seed, then a xorshift stream), on the
// server, in the browser device and in a Next client component alike. Small: well under 1 KB, so it fits the keystore
// record and the sealed roster without moving their padded size classes. Pure: no imports, no I/O.
// scripts/unit-onboarding.mjs checks determinism, distinctness, size and that no URL inside it names a host.

/** the colours a picture's disc may take (calm, readable behind white cells) */
const PALETTE = ["#1d9bf0", "#7856ff", "#f91880", "#00ba7c", "#ff7a00", "#0f766e", "#b45309", "#4338ca", "#be123c", "#15803d"];

/** FNV-1a, 32-bit, over UTF-16 code units (no TextEncoder needed) */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** a xorshift32 stream seeded from the hash (never 0) */
function stream(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

export const LOCAL_AVATAR_PREFIX = "data:image/svg+xml,";

/** the SVG markup for a seed (exported for the unit test; the app uses localAvatar) */
export function localAvatarSvg(seed: string): string {
  const next = stream(fnv1a("layers-avatar/v1:" + String(seed ?? "")));
  const bg = PALETTE[next() % PALETTE.length];
  // 5 columns, mirrored around the middle one: 3 columns x 5 rows of on/off cells (at least 4 on, so never blank)
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (next() % 2 === 0) cells.push([x, y]);
  while (cells.length < 4) {
    const c: [number, number] = [next() % 3, next() % 5];
    if (!cells.some(([a, b]) => a === c[0] && b === c[1])) cells.push(c);
  }
  let d = "";
  for (const [x, y] of cells) {
    d += `M${x + 1.5} ${y + 1.5}h1v1h-1z`;
    if (x < 2) d += `M${5 - x + 0.5} ${y + 1.5}h1v1h-1z`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><circle cx='4' cy='4' r='4' fill='${bg}'/><path fill='#fff' d='${d}'/></svg>`;
}

/** the persona's default picture: an inline data URI, no request to anyone */
export function localAvatar(seed: string): string {
  // only the characters a data: URI must escape here (the markup uses single quotes, so no '"' appears)
  return LOCAL_AVATAR_PREFIX + localAvatarSvg(seed).replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
}

/** is this a picture localAvatar made? */
export function isLocalAvatar(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(LOCAL_AVATAR_PREFIX) && url.includes("viewBox='0 0 8 8'");
}
