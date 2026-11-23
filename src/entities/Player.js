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

    if (!this.frozen && this.onGround && input.isDown('Space')) { this.vel.y = c.jumpSpeed; this.onGround = false; }

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

  syncCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + CONFIG.player.eyeHeight, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
