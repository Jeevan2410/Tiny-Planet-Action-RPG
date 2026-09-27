/**
 * Tiny deterministic PRNG helpers.
 *
 * The whole planet (terrain, prop scatter, enemy spawn points) is generated from
 * a single integer seed so that a saved game re-creates the exact same world on
 * load without having to serialise any of it.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for world generation. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit string hash, for turning names into seeds. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randInt(rng: Rng, min: number, maxInclusive: number): number {
  return Math.floor(min + rng() * (maxInclusive - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}
