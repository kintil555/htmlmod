/**
 * Pure-data ripple simulation (no three.js): a damped 2D wave equation on a grid plus a foam layer.
 * Coordinates are local to the pool (x/z from its min corner, world units). Heights are vertical displacement in world units.
 * `depth` (per cell, world units, 0 = land) shapes damping: waves die out in the shallows and on land, so shores absorb ripples.
 */

/** 3x3 box blur of a depth field (softens the baked shoreline so foam bands are not stair-stepped). */
export function blur3(src, nx, nz) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0; let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          sum += src[jj * nx + ii]; n++;
        }
      }
      out[j * nx + i] = sum / n;
    }
  }
  return out;
}

export class WaterSim {
  /** @param o { nx, nz, cell, depth: Float32Array, speed, step, shoreDamp, deepDamp, shoreFull, edge, limit, foamDecay, crest, crestGain, idle } (see CONFIG.water.sim) */
  constructor(o) {
    this.nx = o.nx; this.nz = o.nz; this.cell = o.cell;
    this.step = o.step; this.limit = o.limit; this.idle = o.idle;
    this.foamKeep = Math.exp(-o.foamDecay * o.step);
    this.crest = o.crest; this.crestGain = o.crestGain;
    // Courant number squared; the 2D scheme is stable up to 0.5.
    this.k = Math.min(0.45, (o.speed * o.step / o.cell) ** 2);
    const n = o.nx * o.nz;
    this.a = new Float32Array(n); this.b = new Float32Array(n); this.c = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.damp = new Float32Array(n);
    for (let j = 0; j < o.nz; j++) {
      for (let i = 0; i < o.nx; i++) {
        const t = Math.min(1, o.depth[j * o.nx + i] / o.shoreFull);
        const edge = Math.min(1, Math.min(i, j, o.nx - 1 - i, o.nz - 1 - j) / o.edge);
        this.damp[j * o.nx + i] = (o.shoreDamp + (o.deepDamp - o.shoreDamp) * t * t * (3 - 2 * t)) * (0.9 + 0.1 * edge);
      }
    }
    this.acc = 0; this.hot = false; this.fresh = false;
    this.energy = 0; this.foamMax = 0;
  }

  /** Pushes the surface down by `amount` (negative = up) over `radius` cells around (x, z), and lays `foam` (0..1) there. */
  splat(x, z, radiusCells, amount, foam = 0) {
    const ci = x / this.cell - 0.5; const cj = z / this.cell - 0.5;
    const r = Math.max(1, radiusCells);
    const i0 = Math.max(1, Math.floor(ci - r)); const i1 = Math.min(this.nx - 2, Math.ceil(ci + r));
    const j0 = Math.max(1, Math.floor(cj - r)); const j1 = Math.min(this.nz - 2, Math.ceil(cj + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d >= 1) continue;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
        const k = j * this.nx + i;
        this.a[k] = Math.max(-this.limit, Math.min(this.limit, this.a[k] - amount * w));
        if (foam > 0) this.foam[k] = Math.min(1, Math.max(this.foam[k], foam * w));
      }
    }
    this.hot = true; this.fresh = true;
  }

  _step() {
    const { nx, nz, a, b, c, damp, foam, k, limit, crest, crestGain, foamKeep } = this;
    let e = 0; let f = 0;
    for (let j = 1; j < nz - 1; j++) {
      const row = j * nx;
      for (let i = 1; i < nx - 1; i++) {
        const q = row + i;
        const h = a[q];
        let v = (2 * h - b[q] + k * (a[q - 1] + a[q + 1] + a[q - nx] + a[q + nx] - 4 * h)) * damp[q];
        if (v > limit) v = limit; else if (v < -limit) v = -limit;
        c[q] = v;
        const av = v < 0 ? -v : v;
        if (av > e) e = av;
        let fo = foam[q] * foamKeep;
        if (av > crest) fo = Math.min(1, fo + (av - crest) * crestGain * this.step);
        foam[q] = fo;
        if (fo > f) f = fo;
      }
    }
    this.b = a; this.a = c; this.c = b;
    this.energy = e; this.foamMax = f;
  }

  /** Runs the fixed steps owed for `dt`. Returns true when the field changed and needs uploading (also once more when it falls asleep). */
  advance(dt) {
    if (!this.hot) return false;
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < 3) { this._step(); this.acc -= this.step; n++; }
    if (n === 3) this.acc = 0;
    if (n > 0) this.fresh = false;
    if (!this.fresh && this.energy < this.idle && this.foamMax < this.idle) {
      this.a.fill(0); this.b.fill(0); this.c.fill(0); this.foam.fill(0);
      this.energy = 0; this.foamMax = 0; this.hot = false;
    }
    return true;
  }

  /** Writes interleaved (height, foam) per cell through `toHalf` into `out` (length 2 * nx * nz). */
  fill(out, toHalf) {
    const { a, foam } = this;
    for (let q = 0; q < a.length; q++) {
      const h = a[q]; const f = foam[q];
      out[2 * q] = h > 1e-5 || h < -1e-5 ? toHalf(h) : 0;
      out[2 * q + 1] = f > 1e-4 ? toHalf(f) : 0;
    }
  }
}
