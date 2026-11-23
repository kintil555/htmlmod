import assert from 'node:assert/strict';
import { stepChaser, newChaserState, riseTime, planObstacle } from '../src/entities/steering.js';
import { Collision } from '../src/world/Collision.js';

const CATCH = 1.7; // upper bound of catch distance (bot radius 1.1 + player 0.4 + 0.2)

const REPATH = 0.2; // matches CONFIG.nextbot.repathInterval: the bot chases a goal snapshot, like GMod's path recompute

/** Player stands still until the bot is within cutDist, then runs sideways at `speed`. Returns min distance after cut. */
function dodge(params, cutDist, speed) {
  const bot = newChaserState(0, 0, 0, 40);
  let px = 0; const pz = 40; let cut = false; let min = Infinity; let gx = px; let gz = pz; let gt = 0;
  for (let t = 0; t < 10; t += 1 / 60) {
    if (!cut && Math.hypot(px - bot.x, pz - bot.z) < cutDist) cut = true;
    if (cut) px += speed / 60;
    gt -= 1 / 60;
    if (gt <= 0) { gx = px; gz = pz; gt = REPATH; }
    stepChaser(bot, gx, gz, 1 / 60, params);
    if (cut) min = Math.min(min, Math.hypot(px - bot.x, pz - bot.z));
  }
  return cut ? min : Infinity;
}
const obunga = { speed: 14.7, turnRate: 2.6, accel: 26, decel: 32 };
const superMunci = { speed: 16.8, turnRate: 2.2, accel: 22, decel: 28 };

assert.ok(dodge(obunga, 3, 21) > CATCH, 'sprint-cut at 3 units dodges Obunga');
assert.ok(dodge(obunga, 3, 14) > CATCH, 'walk-cut at 3 units dodges Obunga');
assert.ok(dodge(superMunci, 3, 14) < CATCH, 'walking cannot escape the fastest bot');
assert.ok(dodge(superMunci, 3, 21) > CATCH, 'sprinting escapes the fastest bot');

// Bot is not an instant-turn homing missile: it still carries forward velocity right after a 90 degree cut.
const b = newChaserState(0, 0, 0, 40); b.vz = 14.7;
let qx = 0;
for (let i = 0; i < 20; i++) { qx += 21 / 60; stepChaser(b, qx, 6, 1 / 60, obunga); }
assert.ok(b.vz > 3, 'slides forward after cut, vz=' + b.vz);

// GMod-style braking: reversing at full speed takes time and distance (decel-limited), not an instant U-turn.
const rev = newChaserState(0, 0, 0, 40); rev.vz = 14.7; let revFrames = 0;
while (rev.vz > 0 && revFrames < 600) { stepChaser(rev, 0, -40, 1 / 60, obunga); revFrames++; }
assert.ok(revFrames / 60 > 0.4, 'needs >0.4s to brake before reversing, got ' + revFrames / 60);
assert.ok(rev.z > 3, 'overshoots >3 units while braking, got ' + rev.z);

// Steady chase: a sprinting player keeps the gap.
const chaser = newChaserState(0, 0, 0, 30); let z = 30;
for (let i = 0; i < 1200; i++) { z += 21 / 60; stepChaser(chaser, 0, z, 1 / 60, superMunci); }
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
// Jump AI.
const N = { clearance: 0.6, jumpMargin: 1.2 };
assert.ok(Math.abs(riseTime(26, 30, 0)) < 1e-9, 'rise time to 0 is 0');
assert.equal(riseTime(26, 30, 12), null, 'apex 11.3 cannot reach 12');
assert.ok(riseTime(26, 30, 5) > 0, 'reachable height has rise time');
const wall = new Collision();
wall.add({ minX: -5, maxX: 5, minZ: 10, maxZ: 12, top: 6 });
const blk = wall.sweepBlocker(0, 0, 0, 1, 20, 0.5, 0);
assert.ok(blk && Math.abs(blk.dist - 9.5) < 1e-6, 'sweep hits wall face minus radius, dist=' + (blk && blk.dist));
assert.equal(wall.sweepBlocker(0, 0, 1, 0, 20, 0.5, 0), null, 'sweep parallel to wall misses');
assert.equal(wall.sweepBlocker(0, 0, 0, 1, 20, 0.5, 6), null, 'wall below feet is not a blocker');
assert.equal(planObstacle(null, 0, 15, 26, 30, 1, N), 'none');
assert.equal(planObstacle({ box: { top: 20 }, dist: 3 }, 0, 15, 26, 30, 1, N), 'avoid', 'too tall: go around');
assert.equal(planObstacle({ box: { top: 6 }, dist: 40 }, 0, 15, 26, 30, 1, N), 'wait', 'far: do not jump yet');
assert.equal(planObstacle({ box: { top: 6 }, dist: 2 }, 0, 15, 26, 30, 1, N), 'jump', 'close: jump');

// Full jump simulation: a bot running at a 6-high wall clears it using the plan.
{
  const g = 30; const vy0 = 26; const sim = new Collision();
  sim.add({ minX: -5, maxX: 5, minZ: 20, maxZ: 22, top: 6 });
  const bot = newChaserState(0, 0, 0, 60); let y = 0; let vy = 0; let ground = true; let crossed = false;
  for (let i = 0; i < 600; i++) {
    const dt = 1 / 60; const sp = Math.hypot(bot.vx, bot.vz);
    const bl = sim.sweepBlocker(bot.x, bot.z, 0, 1, Math.max(3, sp * 0.9) + 0.8, 0.8, y);
    if (ground && planObstacle(bl, y, Math.max(sp, 1), vy0, g, 0.8, N) === 'jump') { vy = vy0; ground = false; }
    stepChaser(bot, 0, 60, dt, superMunci);
    sim.resolveCircle(bot, 0.8, y);
    const prev = y; vy -= g * dt; y += vy * dt;
    const gh = sim.groundHeight(bot.x, bot.z, 0.8, prev);
    if (y <= gh && vy <= 0) { y = gh; vy = 0; ground = true; } else ground = false;
    if (bot.z > 24) { crossed = true; break; }
  }
  assert.ok(crossed, 'bot jumps over a 6-high wall');
}
const NC = { ...N, climbReach: 1.5 };
assert.equal(planObstacle({ box: { top: 20 }, dist: 1 }, 0, 15, 26, 30, 1, NC, true), 'climb', 'tall wall, target above, close: climb');
assert.equal(planObstacle({ box: { top: 20 }, dist: 1 }, 0, 15, 26, 30, 1, NC, false), 'avoid', 'target not above: go around');
assert.equal(planObstacle({ box: { top: 20 }, dist: 9 }, 0, 15, 26, 30, 1, NC, true), 'avoid', 'too far to climb yet');

console.log('all logic tests passed');
