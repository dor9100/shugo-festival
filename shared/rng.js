// Seeded PRNG (mulberry32) + helpers. Deterministic per seed, so schedules can be rebuilt anywhere.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

/** @param {number} [seed] */
export function createRng(seed = randomSeed()) {
  const next = mulberry32(seed);
  const rng = {
    seed: seed >>> 0,
    next,
    /** float in [a, b) */
    range: (a, b) => a + (b - a) * next(),
    /** integer in [a, b] */
    int: (a, b) => a + Math.floor((b - a + 1) * next()),
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** picks a key of `weights` ({key: weight}) proportionally to its weight */
    weighted: (weights) => {
      const keys = Object.keys(weights);
      let total = 0;
      for (const k of keys) total += Math.max(0, weights[k]);
      let r = next() * total;
      for (const k of keys) {
        r -= Math.max(0, weights[k]);
        if (r < 0) return k;
      }
      return keys[keys.length - 1];
    },
    /** in-place Fisher-Yates; returns arr */
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** new 32-bit seed derived from this stream */
    fork: () => (next() * 4294967296) >>> 0,
  };
  return rng;
}
