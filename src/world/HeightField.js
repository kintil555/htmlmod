/**
 * Top-down height field: for every cell of an XZ grid, the highest world Y of any triangle covering the cell centre.
 * Used by SkyAmbient to tell which surfaces can see the sky (nothing above them) and which sit under a roof.
 * Pure data, no GPU, so it can be tested in node.
 *
 * chunks: [{ world: Float32Array (xyz per vertex, world space), index: ArrayLike | null }] (see collectTriangles()).
 * bounds: { minX, maxX, minZ, maxZ }. res: cells along the longer side.
 * Returns { data: Float32Array (row-major, row = Z), width, height, minX, minZ, cell, empty }.
 * Cells nothing covers hold `empty` (far below any surface).
 */
export const HEIGHT_EMPTY = -1e4;

export function rasterizeHeights(chunks, bounds, res) {
  const cell = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / res;
  const minX = bounds.minX - cell; const minZ = bounds.minZ - cell;
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell) + 2;
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 2;
  const data = new Float32Array(width * height).fill(HEIGHT_EMPTY);
  const eps = 1e-6;

  for (const { world, index } of chunks) {
    const count = index ? index.length : world.length / 3;
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = (index ? index[t] : t) * 3;
      const ib = (index ? index[t + 1] : t + 1) * 3;
      const ic = (index ? index[t + 2] : t + 2) * 3;
      const ax = world[ia]; const ay = world[ia + 1]; const az = world[ia + 2];
      const bx = world[ib]; const by = world[ib + 1]; const bz = world[ib + 2];
      const cx = world[ic]; const cy = world[ic + 1]; const cz = world[ic + 2];
      // Signed area in XZ; vertical triangles have none and cannot be seen from above.
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-12) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell - 0.5));
      const i1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cell - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell - 0.5));
      const j1 = Math.min(height - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / cell - 0.5));
      for (let j = j0; j <= j1; j++) {
        const pz = minZ + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = minX + (i + 0.5) * cell;
          const wa = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / area;
          const wb = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / area;
          const wc = 1 - wa - wb;
          if (wa < -eps || wb < -eps || wc < -eps) continue;
          const y = wa * ay + wb * by + wc * cy;
          const k = j * width + i;
          if (y > data[k]) data[k] = y;
        }
      }
    }
  }
  return { data, width, height, minX, minZ, cell, empty: HEIGHT_EMPTY };
}
