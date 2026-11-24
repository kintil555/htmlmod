/**
 * Axis-aligned box colliders in the XZ plane, circle-vs-box resolution.
 * Pure module (no three.js) so it can be unit tested in Node.
 *
 * A box is {minX,maxX,minZ,maxZ,top,bottom?}. `bottom` defaults to -Infinity (solid down to the floor); a finite
 * bottom makes a slab or overhang that movers can pass under (see the `height` argument below).
 * Boxes whose top is within `step` of the mover's feet are walkable. A spatial grid keeps queries cheap.
 * Arbitrary models collide automatically through `addTriangles` (see TriMesh.js): no boxes needed.
 */
import { TriMesh } from './TriMesh.js';

export const STEP_HEIGHT = 0.35;
const GRID_CELL = 8;

export class Collision {
  /** @param {{step?: number, floorY?: number}} opts step = max walkable rise, floorY = height of the infinite floor. */
  constructor({ step = STEP_HEIGHT, floorY = 0 } = {}) {
    this.step = step;
    this.floorY = floorY;
    this.boxes = [];
    this._grid = new Map();
    this._stamp = 0;
    this._hits = [];
    this.tris = new TriMesh();
  }

  /** Makes a triangle soup (world-space xyz Float32Array, optional index list) solid. */
  addTriangles(positions, indices = null) { return this.tris.add(positions, indices); }

  add(box) {
    if (box.bottom === undefined) box.bottom = -Infinity;
    this.boxes.push(box);
    this._index(box);
    return box;
  }

  addAll(boxes) { for (const b of boxes) this.add(b); }

  remove(box) {
    const i = this.boxes.indexOf(box);
    if (i < 0) return;
    this.boxes.splice(i, 1);
    this._cells(box, key => {
      const list = this._grid.get(key);
      list.splice(list.indexOf(box), 1);
      if (!list.length) this._grid.delete(key);
    });
  }

  _cells(b, fn) {
    const x0 = Math.floor(b.minX / GRID_CELL); const x1 = Math.floor(b.maxX / GRID_CELL);
    const z0 = Math.floor(b.minZ / GRID_CELL); const z1 = Math.floor(b.maxZ / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn(ix * 65536 + iz);
  }

  _index(b) {
    this._cells(b, key => {
      const list = this._grid.get(key);
      if (list) list.push(b); else this._grid.set(key, [b]);
    });
  }

  /** Unique boxes overlapping the XZ rectangle. The returned array is reused: consume it before the next query. */
  _near(minX, maxX, minZ, maxZ) {
    const out = this._hits; out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minX / GRID_CELL); const x1 = Math.floor(maxX / GRID_CELL);
    const z0 = Math.floor(minZ / GRID_CELL); const z1 = Math.floor(maxZ / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this._grid.get(ix * 65536 + iz);
        if (!list) continue;
        for (const b of list) if (b._s !== stamp) { b._s = stamp; out.push(b); }
      }
    }
    return out;
  }

  /**
   * Pushes circle `p` ({x,z}) out of solid boxes. Returns last contact normal {nx,nz} or null.
   * `height` is the mover's body height: boxes that start above feetY + height are overhead and ignored.
   */
  resolveCircle(p, r, feetY = 0, height = Infinity) {
    let hit = null;
    for (const b of this._near(p.x - r, p.x + r, p.z - r, p.z + r)) {
      if (b.top <= feetY + this.step || b.bottom >= feetY + height) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      let nx; let nz;
      if (dx === 0 && dz === 0) {
        const l = p.x - b.minX; const rt = b.maxX - p.x; const n = p.z - b.minZ; const f = b.maxZ - p.z;
        const m = Math.min(l, rt, n, f);
        if (m === l) { p.x = b.minX - r; nx = -1; nz = 0; }
        else if (m === rt) { p.x = b.maxX + r; nx = 1; nz = 0; }
        else if (m === n) { p.z = b.minZ - r; nx = 0; nz = -1; }
        else { p.z = b.maxZ + r; nx = 0; nz = 1; }
      } else if (d2 < r * r) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d;
        p.x = cx + nx * r;
        p.z = cz + nz * r;
      } else continue;
      hit = { nx, nz };
    }
    if (this.tris.count) hit = this.tris.resolve(p, r, feetY, height, this.step) ?? hit;
    return hit;
  }

  /** Highest walkable surface under a circle at height y (`floorY` when there is none). */
  groundHeight(x, z, r, y) {
    let g = this.floorY;
    const rr = r * 0.9;
    for (const b of this._near(x - rr, x + rr, z - rr, z + rr)) {
      if (b.top > y + this.step || b.top <= g) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx; const dz = z - cz;
      if (dx * dx + dz * dz < rr * rr || (dx === 0 && dz === 0)) g = b.top;
    }
    if (this.tris.count) g = this.tris.ground(x, z, r, y, this.step, g);
    return g;
  }

  /** Lowest underside above a mover's head (feetY + height) over a circle; Infinity when the way up is open. */
  ceilingHeight(x, z, r, feetY, height) {
    let c = Infinity;
    const rr = r * 0.9;
    const head = feetY + height;
    for (const b of this._near(x - rr, x + rr, z - rr, z + rr)) {
      if (b.bottom < head || b.bottom >= c) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx; const dz = z - cz;
      if (dx * dx + dz * dz < rr * rr || (dx === 0 && dz === 0)) c = b.bottom;
    }
    if (this.tris.count) c = this.tris.ceiling(x, z, r, head, c);
    return c;
  }

  /**
   * Swept circle (radius r) from (x,z) along unit dir (dx,dz) up to `dist`.
   * Returns {box, dist} for the nearest box taller than feetY + step (and not overhead), or null.
   */
  sweepBlocker(x, z, dx, dz, dist, r, feetY = 0, height = Infinity) {
    let best = null;
    const ex = x + dx * dist; const ez = z + dz * dist;
    for (const b of this._near(Math.min(x, ex) - r, Math.max(x, ex) + r, Math.min(z, ez) - r, Math.max(z, ez) + r)) {
      if (b.top <= feetY + this.step || b.bottom >= feetY + height) continue;
      let t0 = 0; let t1 = dist;
      const axes = [[x, dx, b.minX - r, b.maxX + r], [z, dz, b.minZ - r, b.maxZ + r]];
      let ok = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let a = (lo - o) / d; let c = (hi - o) / d;
        if (a > c) { const tmp = a; a = c; c = tmp; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && (!best || t0 < best.dist)) best = { box: b, dist: t0 };
    }
    if (this.tris.count) {
      const m = this.tris.blocker(x, z, dx, dz, dist, r, feetY, height, this.step);
      if (m && (!best || m.dist < best.dist)) best = { box: { top: m.top }, dist: m.dist };
    }
    return best;
  }

  /**
   * Nearest wall within `reach` of a circle's edge, taller than feetY + step (overhead boxes ignored, as in resolveCircle).
   * Returns {nx,nz} (unit normal pointing away from the wall) or null.
   */
  wallContact(x, z, r, reach, feetY = 0, height = Infinity) {
    let best = null; let bestD = Infinity;
    const m = r + reach;
    for (const b of this._near(x - m, x + m, z - m, z + m)) {
      if (b.top <= feetY + this.step || b.bottom >= feetY + height) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx; const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d > r + reach || d >= bestD) continue;
      if (d < 1e-6) continue;
      bestD = d; best = { nx: dx / d, nz: dz / d };
    }
    if (this.tris.count) best = this.tris.wall(x, z, r, reach, feetY, height, this.step) ?? best;
    return best;
  }
}
