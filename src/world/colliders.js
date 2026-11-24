/**
 * Decodes the baked collision block of a map (see tools/bake_map.py) into Collision boxes in game units.
 * Pure module (no three.js) so it can be unit tested in Node.
 * `boxes` is a flat int list, 6 per box: x0 x1 z0 z1 (cell indices) bottom top (height quanta).
 */
export const NO_BOTTOM = -32768;

export function decodeColliders(c, scale) {
  const cell = c.cell * scale; const q = c.quantum * scale;
  const ox = c.originX * scale; const oz = c.originZ * scale;
  const out = [];
  for (let i = 0; i < c.boxes.length; i += 6) {
    const b = c.boxes;
    out.push({
      minX: ox + b[i] * cell, maxX: ox + b[i + 1] * cell,
      minZ: oz + b[i + 2] * cell, maxZ: oz + b[i + 3] * cell,
      bottom: b[i + 4] === NO_BOTTOM ? -Infinity : b[i + 4] * q,
      top: b[i + 5] * q,
    });
  }
  return out;
}
