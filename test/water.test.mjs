import assert from 'node:assert/strict';
import { WaterSim, blur3 } from '../src/world/WaterSim.js';
import { CONFIG } from '../src/config.js';

const nx = 96; const nz = 80; const cell = 0.7;
const depth = new Float32Array(nx * nz).fill(10);
for (let j = 0; j < nz; j++) for (let i = 80; i < nx; i++) depth[j * nx + i] = 0; // land strip on the right
const S = CONFIG.water.sim;
const sim = new WaterSim({ nx, nz, cell, depth: blur3(depth, nx, nz), ...S });

assert.equal(sim.advance(0.1), false, 'idle sim does no work');
sim.splat(30 * cell, 40 * cell, 2.5, 0.4, 1);
assert.ok(sim.hot, 'a splash wakes the sim');
const upload = sim.advance(1 / 60);
assert.ok(upload, 'awake sim asks for an upload');
const peak0 = sim.energy;
assert.ok(peak0 > 0.1, 'splash energy present');

let maxSeen = 0;
for (let t = 0; t < 60; t++) { sim.advance(1 / 60); maxSeen = Math.max(maxSeen, sim.energy); }
for (const v of sim.a) assert.ok(Number.isFinite(v), 'no NaN/Inf');
assert.ok(maxSeen <= S.limit + 1e-6, 'height stays inside the limit');
// The ring has travelled outwards: cells ~ speed * 1s away are disturbed while the centre has calmed.
const at = (i, j) => Math.abs(sim.a[j * nx + i]);
const ring = Math.round(S.speed * 1.0 / cell);
let ringPeak = 0;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const d = Math.hypot(i - 30, j - 40);
  if (Math.abs(d - ring) < 3) ringPeak = Math.max(ringPeak, at(i, j));
}
assert.ok(ringPeak > 1e-3, 'ripple ring reaches its radius');

// Shore absorbs: far side land strip stays much calmer than the open water.
let land = 0; for (let j = 0; j < nz; j++) land = Math.max(land, at(90, j));
assert.ok(land < 0.02, 'land cells stay calm');

// Everything decays and the sim falls asleep, clearing its buffers.
for (let t = 0; t < 60 * 40 && sim.hot; t++) sim.advance(1 / 60);
assert.equal(sim.hot, false, 'sim falls asleep');
assert.ok(sim.a.every(v => v === 0) && sim.foam.every(v => v === 0), 'buffers cleared on sleep');

// fill() packs height + foam and skips zeros.
sim.splat(10, 10, 2, 0.2, 0.8);
const out = new Uint16Array(nx * nz * 2);
sim.fill(out, v => Math.round(v * 1000) + 1);
assert.ok(out.some(v => v > 0), 'fill writes data');
console.log('water tests ok');
