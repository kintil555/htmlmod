import assert from 'node:assert/strict';
import { rasterizeHeights, dilateHeights, HEIGHT_EMPTY } from '../src/world/HeightField.js';

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

console.log('sky tests passed');
