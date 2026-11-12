// mulberry32 — tiny deterministic PRNG, no external dependency. Same seed
// always produces the same sequence, which is what makes `npm run seed`
// idempotent (no Date.now()/Math.random() anywhere in generate.mjs).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const rand = mulberry32(seed);
  return {
    float: () => rand(),
    int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    bool: (pTrue = 0.5) => rand() < pTrue,
  };
}
