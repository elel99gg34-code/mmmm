/**
 * Deterministic, seedable pseudo-random number generation.
 *
 * Both the browser client and the Node server import this module, so a game
 * seeded with the same string produces byte-identical boards on every peer.
 * That is what makes "same board, race for the better score" duels fair, and
 * what lets the server re-simulate a client's moves to validate them.
 */

/** Hash an arbitrary string into a 32-bit integer seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32 — small, fast, statistically decent for game use.
 * Returns a function producing floats in [0, 1).
 */
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

/** A tiny RNG object with the helpers games actually need. */
export class Rng {
  constructor(seed) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed ?? 'playhub'));
    this._next = mulberry32(this.seed);
  }

  /** Float in [0, 1). */
  float() {
    return this._next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  }

  /** Uniform pick from an array. */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  /** Fisher-Yates, in place, returns the same array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** `count` distinct integers drawn from [0, range). */
  sample(range, count) {
    const pool = [];
    for (let i = 0; i < range; i++) pool.push(i);
    this.shuffle(pool);
    return pool.slice(0, count);
  }
}

/** Random-looking seed for a fresh match. */
export function randomSeed() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}
