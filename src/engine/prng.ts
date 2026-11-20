// Deterministic Mulberry32 PRNG + fast 2D value noise + Endian-safe RGBA Uint32 packing

const testBuf = new ArrayBuffer(4);
const testU8 = new Uint8Array(testBuf);
const testU32 = new Uint32Array(testBuf);
testU8[0] = 0x11;
testU8[1] = 0x22;
testU8[2] = 0x33;
testU8[3] = 0x44;
export const IS_LITTLE_ENDIAN = testU32[0] === 0x44332211;

export function packColor(r: number, g: number, b: number, a = 255): number {
  const cr = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const cg = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const cb = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  const ca = a < 0 ? 0 : a > 255 ? 255 : a | 0;
  if (IS_LITTLE_ENDIAN) {
    return ((ca << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
  }
  return ((cr << 24) | (cg << 16) | (cb << 8) | ca) >>> 0;
}

export function unpackColor(c: number): [number, number, number, number] {
  if (IS_LITTLE_ENDIAN) {
    return [c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff];
  }
  return [(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff];
}

export function tintColor(c: number, factor: number): number {
  const [r, g, b, a] = unpackColor(c);
  return packColor(r * factor, g * factor, b * factor, a);
}

export function jitterColor(
  base: [number, number, number],
  rng: () => number,
  variance = 16,
  a = 255
): number {
  const delta = (rng() - 0.5) * 2 * variance;
  return packColor(base[0] + delta, base[1] + delta, base[2] + delta, a);
}

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(min + this.next() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);

  const nx0 = v00 + (v10 - v00) * fx;
  const nx1 = v01 + (v11 - v01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

export function fbm2D(
  x: number,
  y: number,
  seed: number,
  octaves = 3,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency, seed + i * 97) * amplitude;
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / maxVal;
}
