/** FNV-1a hashes every decimal digit, including high bits of large level numbers. */
export function deriveSeed(levelNumber, version = 1, attempt = 0) {
  const text = `screw-fall:${version}:${levelNumber}:${attempt}`;
  let seed = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 16777619);
  }
  return seed >>> 0;
}

/** Mulberry32: compact deterministic 32-bit state, with output in [0, 1). */
export class SeededRandom {
  constructor(seed) { this.state = seed >>> 0; }

  next() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) { return min + (max - min) * this.next(); }
  integer(min, max) { return Math.floor(this.range(min, max + 1)); }
  pick(values) { return values[this.integer(0, values.length - 1)]; }
}
