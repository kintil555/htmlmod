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
