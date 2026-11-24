import * as THREE from 'three';
import { Entity } from './Entity.js';
import { stepChaser, newChaserState, planObstacle } from './steering.js';
import { EDGE } from '../world/NavGraph.js';
import { CONFIG } from '../config.js';

/** Pivot at the feet: tilting to face the camera never sinks the sprite into the floor. */
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

/** Drops the cached material of a nextbot definition (mods call this when they unload). */
export function forgetNextbotMaterial(id) {
  materials.get(id)?.dispose();
  materials.delete(id);
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
    this.y = y;
    this.visY = y;
    this.wp = { x: 0, y: 0, z: 0, type: 0, node: -1 };
    this.hasWp = false;
    this.ban = -1; this.banT = 0;
    this.progT = 0; this.progX = x; this.progY = y; this.progZ = z;
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
    const blk = this.world.collision.sweepBlocker(s.x, s.z, dx, dz, reach, this.radius, this.y, n.bodyHeight, n.stepHeight);
    const plan = planObstacle(blk, this.y, Math.max(sp, 1), n.jumpSpeed, n.gravity, this.radius, n, targetAbove);
    if (plan === 'jump') this._jump();
    else if (plan === 'climb') { this.vy = n.climbSpeed; this.onGround = false; }
    else if (plan === 'avoid') { s.avx = -dx; s.avz = -dz; s.avoidT = n.avoidTime; }

    if (this.onGround && distToTarget > 3 && sp < this.params.speed * n.stuckSpeedFrac) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > n.stuckTime) { this._jump(); this.stuckT = 0; }
  }

  /** Picks the chase goal: the next navigation-graph waypoint toward the player, or the player itself when close / off-graph. */
  _plan(player) {
    const n = CONFIG.nextbot; const s = this.s; const nav = this.world.nav;
    this.goal.x = player.pos.x; this.goal.z = player.pos.z;
    this.hasWp = false;
    if (!nav || !nav.ready) return;
    const node = nav.nodeAt(s.x, s.z, this.y);
    if (node < 0 || nav.costFrom(node) <= n.nav.directCost) return;
    if (nav.waypoint(node, this.wp, this.banT > 0 ? this.ban : -1)) { this.goal.x = this.wp.x; this.goal.z = this.wp.z; this.hasWp = true; }
  }

  /** Not getting anywhere on a planned path: ban the next node for a while so the route changes. */
  _checkProgress(dt) {
    const n = CONFIG.nextbot.nav; const s = this.s;
    if (this.banT > 0) this.banT -= dt;
    this.progT += dt;
    if (this.progT < n.progressTime) return;
    const moved = Math.hypot(s.x - this.progX, s.z - this.progZ) + Math.abs(this.y - this.progY);
    if (this.hasWp && moved < n.progressMin) { this.ban = this.wp.node; this.banT = n.banTime; this.repathT = 0; }
    this.progT = 0; this.progX = s.x; this.progY = this.y; this.progZ = s.z;
  }

  /** Launches a planned jump edge once close enough that the arc reaches the ledge as the bot arrives. */
  _jumpEdge() {
    if (!this.hasWp || this.wp.type !== EDGE.jump || !this.onGround) return;
    const tR = this.world.nav.riseTimeFor(this.wp.y - this.y);
    if (tR === null) return;
    const s = this.s;
    const reach = Math.hypot(s.vx, s.vz) * tR + this.radius + CONFIG.nextbot.jumpMargin;
    if (Math.hypot(this.wp.x - s.x, this.wp.z - s.z) <= reach) this._jump();
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
      if (this.repathT <= 0) { this._plan(player); this.repathT = n.repathInterval; }
      // Wall-scaling is only the fallback for off-graph targets: with a planned path the bot goes around / jumps instead.
      this._navigate(dt, dist, !this.hasWp && player.pos.y > this.y + n.targetAboveGap);
      this._jumpEdge();
      this._checkProgress(dt);
      stepChaser(s, this.goal.x, this.goal.z, dt, this.params);
    }
    if (this.jumpCd > 0) this.jumpCd -= dt;
    const hit = this.world.collision.resolveCircle(s, this.radius, this.y, CONFIG.nextbot.bodyHeight, CONFIG.nextbot.stepHeight);
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
    const ground = this.world.collision.groundHeight(s.x, s.z, this.radius, prevY, gv.stepHeight);
    const wasGround = this.onGround;
    if (this.y <= ground && this.vy <= 0) { this.y = ground; this.vy = 0; this.onGround = true; }
    else if (wasGround && this.vy <= 0 && this.y - ground <= gv.groundSnap) { this.y = ground; this.vy = 0; this.onGround = true; }   // stay glued going downhill
    else this.onGround = false;

    // Visual height eases over steps and slope jitter; airborne it follows exactly. No walk bob.
    if (this.onGround && Math.abs(this.y - this.visY) < 2) this.visY += (this.y - this.visY) * Math.min(1, gv.stepSmooth * dt);
    else this.visY = this.y;
    this.shadow.position.y = ground - this.visY + 0.03;
    this.object3d.position.set(s.x, this.visY, s.z);

    // Billboard: yaw and pitch toward the camera (upright, no roll).
    const cx = camera.position.x - s.x; const cz = camera.position.z - s.z;
    const cy = camera.position.y - (this.visY + this.height / 2);
    this.mesh.rotation.set(-Math.atan2(cy, Math.hypot(cx, cz)), Math.atan2(cx, cz), 0, 'YXZ');
  }
}
