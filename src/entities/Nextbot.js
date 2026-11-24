import * as THREE from 'three';
import { Entity } from './Entity.js';
import { stepChaser, newChaserState, planObstacle } from './steering.js';
import { CONFIG } from '../config.js';

const PLANE = new THREE.PlaneGeometry(1, 1);
PLANE.translate(0, 0.5, 0);
const SHADOW_GEO = new THREE.CircleGeometry(1, 24);
SHADOW_GEO.rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const materials = new Map();

function materialFor(def, texture) {
  if (!materials.has(def.id)) {
    materials.set(def.id, new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
  }
  return materials.get(def.id);
}

/**
 * Billboard chaser. Definition fields (see content/nextbots.js):
 * id, name, texture, height, speed, turnRate, accel, decel.
 */
export class Nextbot extends Entity {
  constructor(def, texture, x, z, face, y = 0) {
    super('nextbot');
    this.def = def;
    this.displayName = def.name;
    this.height = def.height;
    const img = texture.image;
    const width = def.height * (img.width / img.height);
    this.radius = Math.min(1.1, Math.max(0.55, width * 0.28));
    this.params = { speed: def.speed, turnRate: def.turnRate, accel: def.accel, decel: def.decel };
    this.s = newChaserState(x, z, face.x, face.z);
    this.goal = { x: face.x, z: face.z };
    this.repathT = Math.random() * CONFIG.nextbot.repathInterval;
    this.phase = Math.random() * 6;
    this.y = y;
    this.vy = 0;
    this.onGround = true;
    this.jumpCd = 0;
    this.stuckT = 0;

    this.mesh = new THREE.Mesh(PLANE, materialFor(def, texture));
    this.mesh.scale.set(width, def.height, 1);
    this.mesh.userData.entity = this;
    this.pickMesh = this.mesh;

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.scale.setScalar(this.radius * 1.4);
    shadow.position.y = 0.03;
    this.shadow = shadow;
    this.object3d.add(shadow, this.mesh);
    this.object3d.position.set(x, y, z);
  }

  /** True when this bot is touching the player (catch). */
  touches(player) {
    const dx = player.pos.x - this.s.x; const dz = player.pos.z - this.s.z;
    const r = this.radius + player.radius + 0.2;
    return dx * dx + dz * dz < r * r && player.pos.y < this.y + this.height * 0.7 && player.pos.y > this.y - CONFIG.nextbot.catchBelow;
  }

  /** Starts a jump if grounded and off cooldown. */
  _jump() {
    const n = CONFIG.nextbot;
    if (!this.onGround || this.jumpCd > 0) return false;
    this.vy = n.jumpSpeed; this.onGround = false; this.jumpCd = n.jumpCooldown;
    return true;
  }

  /** Look ahead for walls: jump what is clearable, steer around what is not, hop when stuck. */
  _navigate(dt, distToTarget, targetAbove) {
    const n = CONFIG.nextbot; const s = this.s;
    const sp = Math.hypot(s.vx, s.vz);
    const dx = sp > 1 ? s.vx / sp : Math.sin(s.heading);
    const dz = sp > 1 ? s.vz / sp : Math.cos(s.heading);
    const reach = Math.max(n.lookAheadMin, sp * n.lookAheadTime) + this.radius;
    const blk = this.world.collision.sweepBlocker(s.x, s.z, dx, dz, reach, this.radius, this.y, n.bodyHeight);
    const plan = planObstacle(blk, this.y, Math.max(sp, 1), n.jumpSpeed, n.gravity, this.radius, n, targetAbove);
    if (plan === 'jump') this._jump();
    else if (plan === 'climb') { this.vy = n.climbSpeed; this.onGround = false; }
    else if (plan === 'avoid') { s.avx = -dx; s.avz = -dz; s.avoidT = n.avoidTime; }

    if (this.onGround && distToTarget > 3 && sp < this.params.speed * n.stuckSpeedFrac) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > n.stuckTime) { this._jump(); this.stuckT = 0; }
  }

  update(dt, ctx) {
    const { player, camera } = ctx;
    const s = this.s;
    if (player.frozen) {
      const k = Math.exp(-2.5 * dt);
      s.vx *= k; s.vz *= k;
      s.x += s.vx * dt; s.z += s.vz * dt;
    } else {
      const n = CONFIG.nextbot;
      const dist = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
      // GMod PathFollower style: goal is a snapshot of the target, recomputed every repathInterval (no lead, no close boost).
      this.repathT -= dt;
      if (this.repathT <= 0) { this.goal.x = player.pos.x; this.goal.z = player.pos.z; this.repathT = n.repathInterval; }
      this._navigate(dt, dist, player.pos.y > this.y + n.targetAboveGap);
      stepChaser(s, this.goal.x, this.goal.z, dt, this.params);
    }
    if (this.jumpCd > 0) this.jumpCd -= dt;
    const hit = this.world.collision.resolveCircle(s, this.radius, this.y, CONFIG.nextbot.bodyHeight);
    if (hit) {
      const vd = s.vx * hit.nx + s.vz * hit.nz;
      if (vd < 0) { s.vx -= vd * hit.nx; s.vz -= vd * hit.nz; }
      s.avx = hit.nx; s.avz = hit.nz; s.avoidT = 0.4;
    }
    this.world.clamp(s, this.radius);

    const gv = CONFIG.nextbot;
    const prevY = this.y;
    this.vy -= gv.gravity * dt;
    this.y += this.vy * dt;
    if (this.vy > 0) {
      const ceil = this.world.collision.ceilingHeight(s.x, s.z, this.radius, prevY, gv.bodyHeight);
      if (this.y + gv.bodyHeight > ceil) { this.y = ceil - gv.bodyHeight; this.vy = 0; }
    }
    const ground = this.world.collision.groundHeight(s.x, s.z, this.radius, prevY);
    if (this.y <= ground && this.vy <= 0) { this.y = ground; this.vy = 0; this.onGround = true; } else this.onGround = false;
    this.shadow.position.y = ground - this.y + 0.03;

    this.object3d.position.set(s.x, this.y, s.z);
    const speed = Math.hypot(s.vx, s.vz);
    this.phase += speed * dt * 0.9;
    this.mesh.position.y = this.onGround ? Math.abs(Math.sin(this.phase)) * 0.12 * Math.min(1, speed / 6) : 0;
    this.mesh.rotation.y = Math.atan2(camera.position.x - s.x, camera.position.z - s.z);
  }
}
