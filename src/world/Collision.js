/**
 * Axis-aligned box colliders in the XZ plane (with a top height), circle-vs-box resolution.
 * Pure module (no three.js) so it can be unit tested in Node.
 * A box is {minX,maxX,minZ,maxZ,top}. Boxes whose top is within `step` of the mover's feet are walkable.
 */
export const STEP_HEIGHT = 0.35;

export class Collision {
  constructor() { this.boxes = []; }
  add(box) { this.boxes.push(box); return box; }
  remove(box) {
    const i = this.boxes.indexOf(box);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  /** Pushes circle `p` ({x,z}) out of solid boxes. Returns last contact normal {nx,nz} or null. */
  resolveCircle(p, r, feetY = 0) {
    let hit = null;
    for (const b of this.boxes) {
      if (b.top <= feetY + STEP_HEIGHT) continue;
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
    return hit;
  }

  /** Highest walkable surface under a circle at height y (0 = ground). */
  groundHeight(x, z, r, y) {
    let g = 0;
    const rr = r * 0.9;
    for (const b of this.boxes) {
      if (b.top > y + STEP_HEIGHT || b.top <= g) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx; const dz = z - cz;
      if (dx * dx + dz * dz < rr * rr || (dx === 0 && dz === 0)) g = b.top;
    }
    return g;
  }
}
