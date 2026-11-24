/**
 * Automatic mesh collision: any triangle soup (world space) becomes solid, no hand-placed hitboxes.
 * Pure module (no three.js). Movers are vertical capsules (circle footprint of radius r, body `height`).
 * - Floors  (normal.y >= walkY): stand on them; rises up to `step` are walked over.
 * - Walls   (everything else touching the body above `step`): push the mover out horizontally.
 * - Ceilings (facing down): stop jumps.
 * Triangles live in a uniform XZ grid so queries only touch what is near.
 */
const CELL = 4;
const key = (ix, iz) => ix * 65536 + iz;

/** Closest point on triangle (a,b,c as 9 floats at offset o) to p. Writes into out[0..2]. (Ericson, Real-Time Collision Detection) */
function closestOnTri(t, o, px, py, pz, out) {
  const ax = t[o]; const ay = t[o + 1]; const az = t[o + 2];
  const abx = t[o + 3] - ax; const aby = t[o + 4] - ay; const abz = t[o + 5] - az;
  const acx = t[o + 6] - ax; const acy = t[o + 7] - ay; const acz = t[o + 8] - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz; const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - t[o + 3]; const bpy = py - t[o + 4]; const bpz = pz - t[o + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz; const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = t[o + 3]; out[1] = t[o + 4]; out[2] = t[o + 5]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
  const cpx = px - t[o + 6]; const cpy = py - t[o + 7]; const cpz = pz - t[o + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz; const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = t[o + 6]; out[1] = t[o + 7]; out[2] = t[o + 8]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6); out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = t[o + 3] + (t[o + 6] - t[o + 3]) * w; out[1] = t[o + 4] + (t[o + 7] - t[o + 4]) * w; out[2] = t[o + 5] + (t[o + 8] - t[o + 5]) * w; return;
  }
  const den = 1 / (va + vb + vc); const v = vb * den; const w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

export class TriMesh {
  constructor({ walkY = 0.5 } = {}) {
    this.walkY = walkY;
    this.count = 0;
    this.v = new Float32Array(0);   // 9 floats per triangle
    this.n = new Float32Array(0);   // 3 floats per triangle (unit normal)
    this.yr = new Float32Array(0);  // minY, maxY per triangle
    this.grid = new Map();
    this._stamp = new Int32Array(0);
    this._mark = 0;
    this._cp = [0, 0, 0];
    this._hits = [];
  }

  /** positions: Float32Array xyz (world space); indices: optional triangle index list. */
  add(positions, indices = null) {
    const tn = indices ? indices.length / 3 : positions.length / 9;
    const v = new Float32Array((this.count + tn) * 9); v.set(this.v);
    const n = new Float32Array((this.count + tn) * 3); n.set(this.n);
    const yr = new Float32Array((this.count + tn) * 2); yr.set(this.yr);
    let added = 0;
    for (let i = 0; i < tn; i++) {
      const o = (this.count + added) * 9;
      for (let k = 0; k < 3; k++) {
        const vi = indices ? indices[i * 3 + k] * 3 : (i * 3 + k) * 3;
        v[o + k * 3] = positions[vi]; v[o + k * 3 + 1] = positions[vi + 1]; v[o + k * 3 + 2] = positions[vi + 2];
      }
      const ux = v[o + 3] - v[o]; const uy = v[o + 4] - v[o + 1]; const uz = v[o + 5] - v[o + 2];
      const wx = v[o + 6] - v[o]; const wy = v[o + 7] - v[o + 1]; const wz = v[o + 8] - v[o + 2];
      let nx = uy * wz - uz * wy; let ny = uz * wx - ux * wz; let nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      const id = this.count + added;
      n[id * 3] = nx / l; n[id * 3 + 1] = ny / l; n[id * 3 + 2] = nz / l;
      yr[id * 2] = Math.min(v[o + 1], v[o + 4], v[o + 7]); yr[id * 2 + 1] = Math.max(v[o + 1], v[o + 4], v[o + 7]);
      added++;
    }
    const first = this.count;
    this.count += added;
    this.v = v.subarray(0, this.count * 9); this.n = n.subarray(0, this.count * 3); this.yr = yr.subarray(0, this.count * 2);
    this._stamp = new Int32Array(this.count);
    for (let id = first; id < this.count; id++) {
      const o = id * 9;
      const x0 = Math.floor(Math.min(v[o], v[o + 3], v[o + 6]) / CELL); const x1 = Math.floor(Math.max(v[o], v[o + 3], v[o + 6]) / CELL);
      const z0 = Math.floor(Math.min(v[o + 2], v[o + 5], v[o + 8]) / CELL); const z1 = Math.floor(Math.max(v[o + 2], v[o + 5], v[o + 8]) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz); const list = this.grid.get(k);
        if (list) list.push(id); else this.grid.set(k, [id]);
      }
    }
    return added;
  }

  _near(minX, maxX, minZ, maxZ) {
    const out = this._hits; out.length = 0;
    const mark = ++this._mark;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const list = this.grid.get(key(ix, iz));
        if (!list) continue;
        for (const id of list) if (this._stamp[id] !== mark) { this._stamp[id] = mark; out.push(id); }
      }
    }
    return out;
  }

  /** Height of triangle id's plane at (x,z) if that point is inside its XZ projection, else NaN. */
  _heightAt(id, x, z) {
    const t = this.v; const o = id * 9;
    const x0 = t[o]; const z0 = t[o + 2]; const x1 = t[o + 3]; const z1 = t[o + 5]; const x2 = t[o + 6]; const z2 = t[o + 8];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-12) return NaN;
    const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
    const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
    const c = 1 - a - b;
    const e = -1e-4;
    if (a < e || b < e || c < e) return NaN;
    return a * t[o + 1] + b * t[o + 4] + c * t[o + 7];
  }

  /** Highest floor under the footprint that is at most `y + step`; returns `g` when none beats it. */
  ground(x, z, r, y, step, g) {
    const rr = r * 0.7;
    const sx = [x, x + rr, x - rr, x, x]; const sz = [z, z, z, z + rr, z - rr];
    for (const id of this._near(x - rr, x + rr, z - rr, z + rr)) {
      if (this.n[id * 3 + 1] < this.walkY || this.yr[id * 2] > y + step) continue;
      for (let i = 0; i < 5; i++) {
        const h = this._heightAt(id, sx[i], sz[i]);
        if (h <= y + step && h > g) g = h;   // NaN compares false
      }
    }
    return g;
  }

  /** Lowest downward-facing surface at or above the head; Infinity when open. */
  ceiling(x, z, r, head, c) {
    const rr = r * 0.7;
    const sx = [x, x + rr, x - rr, x, x]; const sz = [z, z, z, z + rr, z - rr];
    for (const id of this._near(x - rr, x + rr, z - rr, z + rr)) {
      if (this.n[id * 3 + 1] > -this.walkY || this.yr[id * 2 + 1] < head) continue;
      for (let i = 0; i < 5; i++) {
        const h = this._heightAt(id, sx[i], sz[i]);
        if (h >= head - 0.01 && h < c) c = h;
      }
    }
    return c;
  }

  /** Sphere levels covering the body from `step` above the feet to the top of the head. */
  _levels(feetY, height, r, step) {
    const lo = feetY + step + r;
    const hi = Math.max(lo, feetY + (Number.isFinite(height) ? height : 2) - r);
    return hi - lo < r ? [lo, hi] : [lo, (lo + hi) / 2, hi];
  }

  /** Pushes circle p out of walls (horizontal only). Returns last contact normal {nx,nz} or null. */
  resolve(p, r, feetY, height, step) {
    const levels = this._levels(feetY, height, r, step);
    const lowest = levels[0] - r; const highest = levels[levels.length - 1] + r;
    let hit = null;
    const cp = this._cp;
    for (let pass = 0; pass < 2; pass++) {
      for (const id of this._near(p.x - r, p.x + r, p.z - r, p.z + r)) {
        if (this.yr[id * 2 + 1] < lowest || this.yr[id * 2] > highest) continue;
        for (const cy of levels) {
          closestOnTri(this.v, id * 9, p.x, cy, p.z, cp);
          const dx = p.x - cp[0]; const dy = cy - cp[1]; const dz = p.z - cp[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r) continue;
          let d = Math.sqrt(d2);
          let nx; let nz;
          if (d < 1e-6) { nx = this.n[id * 3]; nz = this.n[id * 3 + 2]; d = 0; } else { nx = dx / d; nz = dz / d; }
          const h = Math.hypot(nx, nz);
          if (h < 0.3) continue;   // contact is mostly vertical: floor or ceiling, not a wall
          const push = r - d;
          p.x += nx * push; p.z += nz * push;
          hit = { nx: nx / h, nz: nz / h };
        }
      }
    }
    return hit;
  }

  /** First wall along a ray for a circle of radius r. Returns {top, dist} (top = highest vertex touched) or null. */
  blocker(x, z, dx, dz, dist, r, feetY, height, step) {
    const levels = this._levels(feetY, height, r, step);
    const lowest = levels[0] - r; const highest = levels[levels.length - 1] + r;
    const cp = this._cp; const stepLen = r * 0.75;
    for (let t = 0; ; t = Math.min(dist, t + stepLen)) {
      const px = x + dx * t; const pz = z + dz * t;
      let top = -Infinity;
      for (const id of this._near(px - r, px + r, pz - r, pz + r)) {
        if (this.yr[id * 2 + 1] < lowest || this.yr[id * 2] > highest) continue;
        for (const cy of levels) {
          closestOnTri(this.v, id * 9, px, cy, pz, cp);
          const ex = px - cp[0]; const ey = cy - cp[1]; const ez = pz - cp[2];
          if (ex * ex + ey * ey + ez * ez >= r * r || Math.hypot(ex, ez) < 0.3 * r) continue;
          top = Math.max(top, this.yr[id * 2 + 1]);
        }
      }
      if (top > -Infinity) return { top, dist: t };
      if (t >= dist) return null;
    }
  }

  /** Nearest steep surface within `reach` of the circle's edge at mid-body. Returns {nx,nz} or null. */
  wall(x, z, r, reach, feetY, height, step) {
    const cy = feetY + step + (Number.isFinite(height) ? (height - step) / 2 : 1);
    const R = r + reach; const cp = this._cp;
    let best = null; let bestD = Infinity;
    for (const id of this._near(x - R, x + R, z - R, z + R)) {
      if (this.yr[id * 2 + 1] < feetY + step || this.yr[id * 2] > feetY + (Number.isFinite(height) ? height : 2)) continue;
      if (Math.abs(this.n[id * 3 + 1]) > 0.7) continue;
      closestOnTri(this.v, id * 9, x, cy, z, cp);
      const dx = x - cp[0]; const dz = z - cp[2];
      const d = Math.hypot(dx, dz, cy - cp[1]);
      if (d > R || d >= bestD || Math.hypot(dx, dz) < 1e-6) continue;
      const h = Math.hypot(dx, dz);
      bestD = d; best = { nx: dx / h, nz: dz / h };
    }
    return best;
  }
}
