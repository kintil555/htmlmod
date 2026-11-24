import assert from 'node:assert/strict';
import { rasterizeHeights, dilateHeights, HEIGHT_EMPTY } from '../src/world/HeightField.js';
import { CONFIG } from '../src/config.js';

// Two quads: a floor at y=0 over [0,10]^2 and a roof at y=5 over [0,4]x[0,10] (two triangles each).
const quad = (x0, x1, z0, z1, y) => ({
  world: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
  index: [0, 1, 2, 0, 2, 3],
});
const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
const f = rasterizeHeights([quad(0, 10, 0, 10, 0), quad(0, 4, 0, 10, 5)], bounds, 100);

const at = (x, z) => f.data[Math.floor((z - f.minZ) / f.cell) * f.width + Math.floor((x - f.minX) / f.cell)];
assert.equal(at(2, 5), 5, 'roof wins where it covers the floor');
assert.equal(at(7, 5), 0, 'open floor keeps its own height');
assert.equal(at(-0.05, 5), HEIGHT_EMPTY, 'outside any triangle stays empty');

// Vertical wall: no area seen from above, must not write anything.
const wall = { world: new Float32Array([0, 0, 0, 0, 9, 0, 0, 9, 10]), index: null };
const g = rasterizeHeights([wall], bounds, 50);
assert.ok(g.data.every(v => v === HEIGHT_EMPTY), 'vertical triangle leaves the field empty');

// Sloped triangle interpolates height.
const slope = { world: new Float32Array([0, 0, 0, 10, 10, 0, 0, 0, 10]), index: null };
const s = rasterizeHeights([slope], bounds, 100);
const h = (x, z) => s.data[Math.floor((z - s.minZ) / s.cell) * s.width + Math.floor((x - s.minX) / s.cell)];
assert.ok(Math.abs(h(5, 1) - 5) < 0.2, 'ramp height at x=5 is about 5, got ' + h(5, 1));

// Dilation grows a roof outwards by `radius` cells and never lowers anything.
const spike = { data: new Float32Array(25).fill(HEIGHT_EMPTY), width: 5, height: 5 };
spike.data[12] = 7;
const grown = dilateHeights(spike, 1);
assert.equal(grown[6], 7, 'diagonal neighbour takes the roof height');
assert.equal(grown[0], HEIGHT_EMPTY, 'cells two away stay empty');
assert.equal(grown[12], 7, 'centre keeps its height');
assert.equal(dilateHeights(spike, 0)[12], 7, 'radius 0 copies');

// Room leak. Roof at y=5 over [0,10]^2 on a floor at y=0; the walls are vertical, so the height field cannot see them.
// ambient() mirrors the ring + enclosure gate of SkyAmbient.js (no per-pixel rotation) with the real CONFIG.
const K = CONFIG.lighting.skyAmbient;
const U = CONFIG.player.eyeHeight;
const room = rasterizeHeights([quad(-20, 30, -20, 30, 0), quad(0, 10, 0, 10, 5)], { minX: -20, maxX: 30, minZ: -20, maxZ: 30 }, 1000);
const solid = dilateHeights(room, K.dilate);
const sample = (x, z) => { // bilinear, like the GPU texture
  const u = (x - room.minX) / room.cell - 0.5; const v = (z - room.minZ) / room.cell - 0.5;
  const i = Math.floor(u); const j = Math.floor(v); const fu = u - i; const fv = v - j;
  const at2 = (a, b) => solid[b * room.width + a];
  return (at2(i, j) * (1 - fu) + at2(i + 1, j) * fu) * (1 - fv) + (at2(i, j + 1) * (1 - fu) + at2(i + 1, j + 1) * fu) * fv;
};
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clearance = (x, y, z) => smooth(0, K.soft * U, y - sample(x, z) + K.bias * U);
const covered = (x, y, z) => smooth(-K.bias * U, 0, sample(x, z) - y);
function ambient([px, py, pz], [nx, ny, nz], gated) {
  const bx = px + nx * K.lift * U; const by = py + ny * K.lift * U; const bz = pz + nz * K.lift * U;
  let open = 0;
  for (let i = 0; i < K.taps; i++) {
    const a = i * 2.399963229728653; const r = Math.sqrt((i + 0.5) / K.taps) * K.reach * U;
    const dx = Math.cos(a) * r; const dz = Math.sin(a) * r;
    const into = Math.min(dx * nx + dz * nz, 0); // part of the offset pointing into the surface
    open += clearance(bx + dx - nx * into, by - ny * into, bz + dz - nz * into);
  }
  const ring = open / K.taps;
  return K.minimum + (1 - K.minimum) * (gated ? ring * (1 - covered(bx, by, bz)) : ring);
}
const floorNear = [[0.5, 0, 5], [0, 1, 0]]; // inside the room, half a unit from a wall
const wallNear = [[0.02, 1, 5], [1, 0, 0]]; // interior face of that wall
const floorMid = [[5, 0, 5], [0, 1, 0]];
assert.ok(ambient(...floorNear, false) > K.minimum + 0.1, 'ungated ring leaks along the wall (the bug)');
for (const [name, [p, n]] of Object.entries({ floorNear, wallNear, floorMid })) {
  assert.ok(Math.abs(ambient(p, n, true) - K.minimum) < 1e-6, name + ' inside the room gets exactly the minimum, got ' + ambient(p, n, true));
}
const outside = [[-0.5, 0, 5], [0, 1, 0]]; // open ground beside the room keeps its gradient
assert.ok(Math.abs(ambient(...outside, true) - ambient(...outside, false)) < 1e-6, 'open ground is unchanged by the gate');
assert.ok(ambient(...outside, true) > K.minimum + 0.1 && ambient(...outside, true) < 1, 'open ground beside the wall is partly occluded');
const openGround = [[-15, 0, -15], [0, 1, 0]];
const roofTop = [[5, 5, 5], [0, 1, 0]];
for (const [p, n] of [openGround, roofTop]) assert.ok(Math.abs(ambient(p, n, true) - ambient(p, n, false)) < 1e-6, 'gate leaves open surfaces alone');
assert.ok(ambient(...outside, true) < ambient(...openGround, true) - 0.05, 'ground beside the wall is darker than open ground');

console.log('sky tests passed');
