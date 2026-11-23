import * as THREE from 'three';
import { Entity } from './Entity.js';
import { stepChaser, newChaserState } from './steering.js';
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
 * id, name, texture, height, speed, turnRate, grip.
 */
export class Nextbot extends Entity {
  constructor(def, texture, x, z, face) {
    super('nextbot');
    this.def = def;
    this.displayName = def.name;
    this.height = def.height;
    const img = texture.image;
    const width = def.height * (img.width / img.height);
    this.radius = Math.min(1.1, Math.max(0.55, width * 0.28));
    this.params = { speed: def.speed, turnRate: def.turnRate, grip: def.grip };
    this.s = newChaserState(x, z, face.x, face.z);
    this.phase = Math.random() * 6;

    this.mesh = new THREE.Mesh(PLANE, materialFor(def, texture));
    this.mesh.scale.set(width, def.height, 1);
    this.mesh.userData.entity = this;
    this.pickMesh = this.mesh;

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.scale.setScalar(this.radius * 1.4);
    shadow.position.y = 0.03;
    this.object3d.add(shadow, this.mesh);
    this.object3d.position.set(x, 0, z);
  }

  /** True when this bot is touching the player (catch). */
  touches(player) {
    const dx = player.pos.x - this.s.x; const dz = player.pos.z - this.s.z;
    const r = this.radius + player.radius + 0.2;
    return dx * dx + dz * dz < r * r && player.pos.y < this.height * 0.7;
  }

  update(dt, ctx) {
    const { player, camera } = ctx;
    const s = this.s;
    if (player.frozen) {
      const k = Math.exp(-2.5 * dt);
      s.vx *= k; s.vz *= k;
      s.x += s.vx * dt; s.z += s.vz * dt;
    } else {
      stepChaser(s, player.pos.x, player.pos.z, dt, this.params);
    }
    const hit = this.world.collision.resolveCircle(s, this.radius, 0);
    if (hit) {
      const vd = s.vx * hit.nx + s.vz * hit.nz;
      if (vd < 0) { s.vx -= vd * hit.nx; s.vz -= vd * hit.nz; }
      s.avx = hit.nx; s.avz = hit.nz; s.avoidT = 0.4;
    }
    const lim = CONFIG.world.halfSize - this.radius;
    s.x = Math.max(-lim, Math.min(lim, s.x));
    s.z = Math.max(-lim, Math.min(lim, s.z));

    this.object3d.position.set(s.x, 0, s.z);
    const speed = Math.hypot(s.vx, s.vz);
    this.phase += speed * dt * 0.9;
    this.mesh.position.y = Math.abs(Math.sin(this.phase)) * 0.12 * Math.min(1, speed / 6);
    this.mesh.rotation.y = Math.atan2(camera.position.x - s.x, camera.position.z - s.z);
  }
}
