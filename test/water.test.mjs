import assert from 'node:assert/strict';
import { WaterSim, blur3 } from '../src/world/WaterSim.js';
import { CONFIG } from '../src/config.js';
import { waveFade, swashLift, swashBump, swashPhase } from '../src/world/Shore.js';

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

// --- Shoreline swash: waves run up the bank and drain back ---
const SH = CONFIG.water.shore;
const X = 3; const Z = 5; const T = SH.period; const steps = 600;
const thick = (d, t) => d + swashLift(X, Z, d, t);
/** Waterline: lowest signed depth reached by water that is wet all the way from the sea (d = 3) down the slope. */
const waterline = (t) => { let f = 3; for (let d = 3; d >= -2; d -= 0.005) { if (thick(d, t) <= 0) break; f = d; } return f; };
const line = []; for (let i = 0; i <= steps; i++) line.push(waterline(i / steps * T));

assert.ok(Math.min(...line) < -SH.height * 0.4, 'uprush reaches onto the bank');
assert.ok(Math.max(...line) > SH.height * 0.4, 'backwash draws the waterline back into the water');
assert.ok(Math.min(...line) > -SH.reach, 'run-up stays below reach');
let turns = 0; let dir = 0;
for (let i = 1; i < line.length; i++) { const dd = Math.sign(line[i] - line[i - 1]); if (dd && dd !== dir) { if (dir) turns++; dir = dd; } }
assert.ok(turns >= 2 && turns <= 4, `one rise and one recede per cycle (got ${turns} turns)`);

let dryHigh = true; for (let i = 0; i <= steps; i++) if (thick(-SH.reach - 0.02, i / steps * T) > 0) dryHigh = false;
assert.ok(dryHigh, 'ground above reach stays dry');
assert.equal(waveFade(-CONFIG.water.waves.bankFade - 0.01), 0, 'open-water waves never lift the bank');
assert.ok(waveFade(0.5) > waveFade(0) && waveFade(0) > 0, 'waves shrink toward the waterline but do not vanish');

// Uprush is faster than the backwash; crest arrives later higher up the slope.
const peak = SH.rise; assert.ok(swashBump(peak) > 0.999 && swashBump(0) < 1e-9 && swashBump(1) < 1e-9, 'bump peaks at rise, zero at the cycle ends');
assert.ok(SH.rise < 0.5, 'uprush shorter than backwash');
const crestT = d => { let best = 0; let bt = 0; for (let i = 0; i < 2000; i++) { const t = i / 2000 * T; const u = swashPhase(X, Z, d, t); if (swashBump(u) > best) { best = swashBump(u); bt = t; } } return bt; };
const lag = (crestT(-0.1) - crestT(0.1) + 2 * T) % T;
const expected = ((0.2 * SH.phasePerDepth * T) % T + T) % T;
assert.ok(Math.abs(lag - expected) < 0.02 * T, `crest travels shoreward (lag ${lag.toFixed(2)}s, expected ${expected.toFixed(2)}s)`);
console.log('shore swash ok');
