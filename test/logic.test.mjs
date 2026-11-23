import assert from 'node:assert/strict';
import { stepChaser, newChaserState } from '../src/entities/steering.js';
import { Collision } from '../src/world/Collision.js';

const CATCH = 1.7; // upper bound of catch distance (bot radius 1.1 + player 0.4 + 0.2)

/** Player stands still until the bot is within cutDist, then runs sideways at `speed`. Returns min distance after cut. */
function dodge(params, cutDist, speed) {
  const bot = newChaserState(0, 0, 0, 40);
  let px = 0; const pz = 40; let cut = false; let min = Infinity;
  for (let t = 0; t < 10; t += 1 / 60) {
    if (!cut && Math.hypot(px - bot.x, pz - bot.z) < cutDist) cut = true;
    if (cut) px += speed / 60;
    stepChaser(bot, px, pz, 1 / 60, params);
    if (cut) min = Math.min(min, Math.hypot(px - bot.x, pz - bot.z));
  }
  return cut ? min : Infinity;
}
const obunga = { speed: 10.5, turnRate: 2.6, grip: 3.0 };
const superMunci = { speed: 12, turnRate: 2.2, grip: 2.2 };

assert.ok(dodge(obunga, 3, 15) > CATCH, 'sprint-cut at 3 units dodges Obunga');
assert.ok(dodge(obunga, 3, 10) > CATCH, 'walk-cut at 3 units dodges Obunga');
assert.ok(dodge(superMunci, 3, 10) < CATCH, 'walking cannot escape the fastest bot');
assert.ok(dodge(superMunci, 3, 15) > CATCH, 'sprinting escapes the fastest bot');

// Bot is not an instant-turn homing missile: it still carries forward velocity right after a 90 degree cut.
const b = newChaserState(0, 0, 0, 40); b.vz = 10.5;
let qx = 0;
for (let i = 0; i < 20; i++) { qx += 15 / 60; stepChaser(b, qx, 6, 1 / 60, obunga); }
assert.ok(b.vz > 3, 'slides forward after cut, vz=' + b.vz);

// Steady chase: a sprinting player keeps the gap.
const chaser = newChaserState(0, 0, 0, 30); let z = 30;
for (let i = 0; i < 1200; i++) { z += 15 / 60; stepChaser(chaser, 0, z, 1 / 60, superMunci); }
assert.ok(z - chaser.z > 20, 'sprinter keeps gap');

// Collision.
const c = new Collision();
c.add({ minX: -1, maxX: 1, minZ: -1, maxZ: 1, top: 3 });
const pt = { x: 1.2, z: 0 };
const hit = c.resolveCircle(pt, 0.5, 0);
assert.ok(hit && hit.nx === 1 && pt.x >= 1.5 - 1e-9, 'pushed out along +x');
const inside = { x: 0.1, z: 0 };
c.resolveCircle(inside, 0.5, 0);
assert.ok(Math.abs(inside.x) >= 1.5 || Math.abs(inside.z) >= 1.5, 'inside center pushed out');
assert.equal(c.groundHeight(0, 0, 0.4, 3), 3);
assert.equal(c.groundHeight(0, 0, 0.4, 0), 0, 'cannot step onto a 3m box from the ground');
assert.equal(c.resolveCircle({ x: 0, z: 0 }, 0.4, 3), null, 'standing on top: no horizontal push');
console.log('all logic tests passed');
