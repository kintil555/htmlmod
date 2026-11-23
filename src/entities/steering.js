/**
 * Nextbot chase steering. Pure math (no three.js) so it is unit tested in Node.
 * State s: {x,z,vx,vz,heading,avx,avz,avoidT}; forward = (sin heading, cos heading).
 * params: {speed, turnRate (rad/s), grip (1/s, lower = more slide)}.
 *
 * Why it can be dodged: heading turns at a limited rate, velocity lags heading by `grip`,
 * and speed drops when facing away from the target. A late sideways cut makes the bot overshoot.
 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function stepChaser(s, tx, tz, dt, p) {
  const dx = tx - s.x; const dz = tz - s.z;
  const dist = Math.hypot(dx, dz);
  let diff = 0;
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
    diff = wrapAngle(want - s.heading);
    const maxTurn = p.turnRate * dt;
    s.heading = wrapAngle(s.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }
  const align = Math.max(0, Math.cos(diff));
  const target = p.speed * (0.35 + 0.65 * align);
  const k = 1 - Math.exp(-p.grip * dt);
  s.vx += (Math.sin(s.heading) * target - s.vx) * k;
  s.vz += (Math.cos(s.heading) * target - s.vz) * k;
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

/** Where to aim: the target's position extrapolated along its velocity (pursuit, not tail-chasing). */
export function leadPoint(s, tx, tz, tvx, tvz, speed, factor, maxT) {
  const dist = Math.hypot(tx - s.x, tz - s.z);
  const t = Math.min(maxT, dist / Math.max(speed, 1)) * factor;
  return { x: tx + tvx * t, z: tz + tvz * t };
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

/** Tighter turning and grip when close, so late sideways cuts overshoot less. */
export function closeParams(p, dist, n) {
  const k = Math.max(0, 1 - dist / n.closeRange);
  return { speed: p.speed, turnRate: p.turnRate * (1 + n.closeTurnBoost * k), grip: p.grip * (1 + n.closeGripBoost * k) };
}
