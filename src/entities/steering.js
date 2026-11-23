/**
 * Nextbot chase steering. Pure math (no three.js) so it is unit tested in Node.
 * State s: {x,z,vx,vz,heading,avx,avz,avoidT}; forward = (sin heading, cos heading).
 * params: {speed, turnRate (rad/s), accel (u/s^2), decel (u/s^2)}.
 *
 * Modeled on GMod's CLuaLocomotion: heading turns at a limited yaw rate, and velocity changes by at
 * most `accel` per second toward heading*speed (up to `decel` when that change opposes the current
 * velocity). Reversing therefore means braking first, so a late sideways cut makes the bot overshoot.
 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function stepChaser(s, tx, tz, dt, p) {
  const dx = tx - s.x; const dz = tz - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-4) {
    let want = Math.atan2(dx, dz);
    if (s.avoidT > 0) {
      s.avoidT -= dt;
      const ux = dx / dist; const uz = dz / dist;
      if (ux * s.avx + uz * s.avz < -0.15) {
        let tx2 = -s.avz; let tz2 = s.avx;
        if (tx2 * ux + tz2 * uz < 0) { tx2 = -tx2; tz2 = -tz2; }
        want = Math.atan2(tx2, tz2);
      }
    }
    const diff = wrapAngle(want - s.heading);
    const maxTurn = p.turnRate * dt;
    s.heading = wrapAngle(s.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }
  const wx = Math.sin(s.heading) * p.speed - s.vx;
  const wz = Math.cos(s.heading) * p.speed - s.vz;
  const len = Math.hypot(wx, wz);
  if (len > 1e-6) {
    const sp = Math.hypot(s.vx, s.vz);
    const opposing = sp > 1e-3 ? Math.max(0, -(wx * s.vx + wz * s.vz) / (len * sp)) : 0;
    const rate = p.accel + (p.decel - p.accel) * opposing;
    const k = Math.min(1, (rate * dt) / len);
    s.vx += wx * k;
    s.vz += wz * k;
  }
  s.x += s.vx * dt;
  s.z += s.vz * dt;
}

export function newChaserState(x, z, faceX, faceZ) {
  return { x, z, vx: 0, vz: 0, heading: Math.atan2(faceX - x, faceZ - z), avx: 0, avz: 0, avoidT: 0 };
}

/** Time to rise `h` units with launch speed vy under gravity g; null if the apex is lower than h. */
export function riseTime(vy, g, h) {
  const disc = vy * vy - 2 * g * h;
  if (disc < 0) return null;
  return (vy - Math.sqrt(disc)) / g;
}

/**
 * Decide what to do about a blocker ahead. Returns 'jump' (start the jump now),
 * 'wait' (clearable, but too early), 'climb' (too tall but the target is above: scale it), 'avoid' (too tall: go around) or 'none'.
 */
export function planObstacle(blocker, feetY, speed, jumpSpeed, gravity, radius, n, targetAbove = false) {
  if (!blocker) return 'none';
  const tRise = riseTime(jumpSpeed, gravity, blocker.box.top - feetY + n.clearance);
  if (tRise === null) return targetAbove && blocker.dist <= radius + n.climbReach ? 'climb' : 'avoid';
  return blocker.dist <= speed * tRise + radius + n.jumpMargin ? 'jump' : 'wait';
}

/** Close range: a nextbot corners harder and brakes/accelerates faster, so late cuts overshoot less (GMod bots hug tight near the target). */
export function closeParams(p, dist, n) {
  const k = Math.max(0, 1 - dist / n.closeRange);
  return {
    speed: p.speed,
    turnRate: p.turnRate * (1 + n.closeTurnBoost * k),
    accel: p.accel * (1 + n.closeAccelBoost * k),
    decel: p.decel * (1 + n.closeAccelBoost * k),
  };
}

/** Where to aim: the target position extrapolated along its velocity (mild pursuit, not tail-chasing). */
export function leadPoint(s, tx, tz, tvx, tvz, speed, factor, maxT) {
  const dist = Math.hypot(tx - s.x, tz - s.z);
  const t = Math.min(maxT, dist / Math.max(speed, 1)) * factor;
  return { x: tx + tvx * t, z: tz + tvz * t };
}
