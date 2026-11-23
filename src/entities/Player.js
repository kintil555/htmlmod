import * as THREE from 'three';
import { CONFIG } from '../config.js';

/** First-person controller. Feet position is `pos`; camera sits at eye height. */
export class Player {
  constructor(camera) {
    this.camera = camera;
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
    this.respawn();
  }

  respawn() {
    const s = CONFIG.player.spawn;
    this.pos.set(s.x, 0, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw;
    this.pitch = 0;
    this.frozen = false;
    this.onGround = true;
    this.syncCamera();
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  update(dt, input, world) {
    const c = CONFIG.player;
    const look = input.consumeLook();
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
    const top = this.sprinting ? c.sprintSpeed : c.walkSpeed;

    const acc = c.accel * (this.onGround ? 1 : c.airControl) * dt;
    let ax = wx * top - this.vel.x; let az = wz * top - this.vel.z;
    const al = Math.hypot(ax, az);
    if (al > acc) { ax *= acc / al; az *= acc / al; }
    this.vel.x += ax; this.vel.z += az;

    if (space && this.onGround) { this.vel.y = c.jumpSpeed; this.onGround = false; }
    else if (spacePressed && !this.onGround && this.wallCd <= 0) this._wallJump(world, wx, wz, wl > 0, sin, cos);

    // Horizontal move + collide.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const hit = world.collision.resolveCircle(this.pos, this.radius, this.pos.y);
    if (hit) {
      const vd = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vd < 0) { this.vel.x -= vd * hit.nx; this.vel.z -= vd * hit.nz; }
    }
    const lim = CONFIG.world.halfSize - 1;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    // Vertical.
    const prevY = this.pos.y;
    this.vel.y -= c.gravity * dt;
    this.pos.y += this.vel.y * dt;
    const ground = world.collision.groundHeight(this.pos.x, this.pos.z, this.radius, prevY);
    if (this.pos.y <= ground && this.vel.y <= 0) {
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    } else {
      this.onGround = false;
    }

    const fov = this.sprinting && this.speed > c.walkSpeed ? c.sprintFov : c.fov;
    const nf = this.camera.fov + (fov - this.camera.fov) * Math.min(1, dt * 8);
    if (Math.abs(nf - this.camera.fov) > 0.01) { this.camera.fov = nf; this.camera.updateProjectionMatrix(); }
    this.syncCamera();
  }

  /**
   * Wall jump: while airborne next to a wall, a fresh Space press kicks upward.
   * Aim = move keys (or look direction when none). Aiming away/sideways launches that way;
   * aiming into the wall only nudges off it, so repeated presses climb the same wall.
   */
  _wallJump(world, wx, wz, hasInput, sin, cos) {
    const w = CONFIG.player.wallJump;
    const n = world.collision.wallContact(this.pos.x, this.pos.z, this.radius, w.reach, this.pos.y);
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
    this.camera.position.set(this.pos.x, this.pos.y + CONFIG.player.eyeHeight, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
