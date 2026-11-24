import * as THREE from 'three';
import { CONFIG } from '../config.js';

/** First-person controller. Feet position is `pos`; camera sits at eye height. `spawn` = {x,y,z,yaw}. */
export class Player {
  constructor(camera, spawn) {
    this.camera = camera;
    this.spawn = spawn;
    this.eyeLag = 0;
    this.camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = CONFIG.player.radius;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.sprinting = false;
    this.frozen = false;
    this.invulnerable = 0;
    this.spaceWas = false;
    this.wallCd = 0;
    this.rag = null;
    this.respawn();
  }

  respawn() {
    this.rag = null;
    const s = this.spawn;
    this.eyeLag = 0;
    this.pos.set(s.x, s.y, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw;
    this.pitch = 0;
    this.frozen = false;
    this.onGround = true;
    this.syncCamera();
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** Freeze the player and turn the camera into a tumbling head, thrown away from (fromX, fromZ). */
  die(fromX, fromZ) {
    const r = CONFIG.ragdoll;
    this.frozen = true;
    let dx = this.pos.x - fromX; let dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); }
    const side = Math.random() < 0.5 ? -1 : 1;
    this.rag = {
      pos: new THREE.Vector3(this.pos.x, this.pos.y + CONFIG.player.eyeHeight, this.pos.z),
      vel: new THREE.Vector3(this.vel.x + dx * r.knockback, this.vel.y + r.pop, this.vel.z + dz * r.knockback),
      pitch: this.pitch,
      yaw: this.yaw,
      roll: 0,
      wPitch: -r.spinPitch * (0.6 + Math.random() * 0.8),
      wYaw: side * r.spinYaw * (0.5 + Math.random()),
      wRoll: side * r.spinRoll * (0.7 + Math.random() * 0.6),
      grounded: false,
    };
  }

  /** Free-flying head: gravity, wall and floor collision, bounce, spin that damps out and settles on its side. */
  _updateRagdoll(dt, world) {
    const r = CONFIG.ragdoll; const g = this.rag;
    const hr = r.headRadius;
    const drag = Math.exp(-r.airDrag * dt);
    g.vel.x *= drag; g.vel.z *= drag;
    g.vel.y -= r.gravity * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.z += g.vel.z * dt;
    const feet = g.pos.y - hr;
    const hit = world.collision.resolveCircle(g.pos, hr, feet, hr * 2);
    if (hit) {
      const vd = g.vel.x * hit.nx + g.vel.z * hit.nz;
      if (vd < 0) { g.vel.x -= (1 + r.restitution) * vd * hit.nx; g.vel.z -= (1 + r.restitution) * vd * hit.nz; }
    }
    world.clamp(g.pos, hr);

    const prevY = g.pos.y;
    g.pos.y += g.vel.y * dt;
    const floor = world.collision.groundHeight(g.pos.x, g.pos.z, hr, prevY - hr) + hr;
    g.grounded = false;
    if (g.pos.y <= floor && g.vel.y <= 0) {
      g.pos.y = floor;
      if (-g.vel.y > r.restSpeed) {
        g.vel.y = -g.vel.y * r.restitution;
        g.wPitch *= r.bounceSpinKeep; g.wYaw *= r.bounceSpinKeep; g.wRoll *= r.bounceSpinKeep;
      } else {
        g.vel.y = 0;
        g.grounded = true;
      }
    }

    g.pitch += g.wPitch * dt;
    g.yaw += g.wYaw * dt;
    g.roll += g.wRoll * dt;

    if (g.grounded) {
      const fr = Math.exp(-r.groundFriction * dt);
      g.vel.x *= fr; g.vel.z *= fr;
      const sd = Math.exp(-r.groundSpinDamp * dt);
      g.wPitch *= sd; g.wYaw *= sd; g.wRoll *= sd;
      if (Math.hypot(g.wPitch, g.wRoll, g.wYaw) < 1.5) {
        // Lying still: ease to a stable side-on view (roll to nearest quarter turn, pitch level).
        const k = Math.min(1, dt * r.settleRate);
        const half = Math.PI / 2;
        g.roll += (Math.round(g.roll / half) * half - g.roll) * k;
        g.pitch += (Math.round(g.pitch / Math.PI) * Math.PI - g.pitch) * k;
        g.wPitch = 0; g.wRoll = 0; g.wYaw = 0;
      }
    }

    this.camera.position.copy(g.pos);
    this.camera.rotation.set(g.pitch, g.yaw, g.roll);
  }

  update(dt, input, world) {
    const c = CONFIG.player;
    const look = input.consumeLook();
    if (this.rag) { this._updateRagdoll(dt, world); return; }
    if (!this.frozen) {
      this.yaw -= look.dx * c.lookSensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - look.dy * c.lookSensitivity));
    }
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.wallCd > 0) this.wallCd -= dt;
    const space = !this.frozen && input.isDown('Space');
    const spacePressed = space && !this.spaceWas;
    this.spaceWas = space;

    let fwd = 0; let strafe = 0;
    if (!this.frozen) {
      fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    }
    const sin = Math.sin(this.yaw); const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * strafe;
    let wz = -cos * fwd - sin * strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const moving = wl > 0;
    this.sprinting = moving && fwd >= 0 && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    // Water (Water.js): wading slows you, past `swim.at` of the body under water you swim.
    const sw = CONFIG.water.swim;
    const sub = world.water?.submersion(this.pos, c.height) ?? 0;
    const swimming = sub >= sw.at;
    const top = (this.sprinting ? c.sprintSpeed : c.walkSpeed) * (1 - sw.slow * sub);

    const acc = c.accel * (swimming ? sw.accel : this.onGround ? 1 : c.airControl) * dt;
    let ax = wx * top - this.vel.x; let az = wz * top - this.vel.z;
    const al = Math.hypot(ax, az);
    if (al > acc) { ax *= acc / al; az *= acc / al; }
    this.vel.x += ax; this.vel.z += az;
    if (sub > 0) { const k = Math.exp(-sw.dragXZ * sub * dt); this.vel.x *= k; this.vel.z *= k; }

    if (swimming) this._swim(dt, input, space, spacePressed, sub, fwd, top);
    else if (space && this.onGround) { this.vel.y = c.jumpSpeed; this.onGround = false; }
    else if (spacePressed && !this.onGround && this.wallCd <= 0) this._wallJump(world, wx, wz, wl > 0, sin, cos);

    // Horizontal move + collide.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const hit = world.collision.resolveCircle(this.pos, this.radius, this.pos.y, c.height);
    if (hit) {
      const vd = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vd < 0) { this.vel.x -= vd * hit.nx; this.vel.z -= vd * hit.nz; }
    }
    world.clamp(this.pos, this.radius);

    // Vertical.
    const prevY = this.pos.y;
    const wasGround = this.onGround;
    this.vel.y -= c.gravity * (1 - sw.buoyancy * sub) * dt;
    if (sub > 0) this.vel.y *= Math.exp(-sw.dragY * sub * dt);
    this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) {
      const ceil = world.collision.ceilingHeight(this.pos.x, this.pos.z, this.radius, prevY, c.height);
      if (this.pos.y + c.height > ceil) { this.pos.y = ceil - c.height; this.vel.y = 0; }
    }
    const ground = world.collision.groundHeight(this.pos.x, this.pos.z, this.radius, prevY);
    if (this.pos.y <= ground && this.vel.y <= 0) {
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    } else {
      this.onGround = false;
    }
    // Stairs and slopes are stepped: keep the camera where it was and let it ease to the new height.
    const rise = this.pos.y - prevY;
    if (wasGround && this.onGround && Math.abs(rise) > 1e-4 && Math.abs(rise) <= c.stepHeight + 0.01) {
      this.eyeLag = Math.max(-c.stepHeight, Math.min(c.stepHeight, this.eyeLag - rise));
    }
    this.eyeLag *= Math.exp(-c.stepSmooth * dt);

    const fov = this.sprinting && this.speed > c.walkSpeed ? c.sprintFov : c.fov;
    const nf = this.camera.fov + (fov - this.camera.fov) * Math.min(1, dt * 8);
    if (Math.abs(nf - this.camera.fov) > 0.01) { this.camera.fov = nf; this.camera.updateProjectionMatrix(); }
    this.syncCamera();
  }

  /** Swimming: Space rises, C dives, W/S swim along the look direction, and a Space press at the surface hops out. */
  _swim(dt, input, space, spacePressed, sub, fwd, top) {
    const sw = CONFIG.water.swim;
    const dive = !this.frozen && input.isDown('KeyC');
    this.vel.y += ((space ? sw.up : 0) - (dive ? sw.down : 0)) * dt;
    if (fwd !== 0) this.vel.y += (Math.sin(this.pitch) * fwd * top * sw.pitchSpeed - this.vel.y) * Math.min(1, dt * 6);
    this.vel.y = Math.max(-sw.downMax, Math.min(sw.upMax, this.vel.y));
    if (spacePressed && sub < 0.9) this.vel.y = Math.max(this.vel.y, sw.exitJump);
    this.onGround = false;
  }

  /**
   * Wall jump: while airborne next to a wall, a fresh Space press kicks upward.
   * Aim = move keys (or look direction when none). Aiming away/sideways launches that way;
   * aiming into the wall only nudges off it, so repeated presses climb the same wall.
   */
  _wallJump(world, wx, wz, hasInput, sin, cos) {
    const w = CONFIG.player.wallJump;
    const n = world.collision.wallContact(this.pos.x, this.pos.z, this.radius, w.reach, this.pos.y, CONFIG.player.height);
    if (!n) return;
    let dx = wx; let dz = wz;
    if (!hasInput) { dx = -sin; dz = -cos; }
    const into = dx * n.nx + dz * n.nz; // < 0: aiming into the wall
    if (into < -0.5) {
      this.vel.x = n.nx * w.climbAway; this.vel.z = n.nz * w.climbAway;
    } else {
      if (into < 0) { dx -= into * n.nx; dz -= into * n.nz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      let vx = dx * w.kickSpeed; let vz = dz * w.kickSpeed;
      const away = vx * n.nx + vz * n.nz;
      if (away < w.minAway) { vx += n.nx * (w.minAway - away); vz += n.nz * (w.minAway - away); }
      this.vel.x = vx; this.vel.z = vz;
    }
    this.vel.y = w.upSpeed;
    this.wallCd = w.cooldown;
  }

  syncCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + CONFIG.player.eyeHeight + this.eyeLag, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
