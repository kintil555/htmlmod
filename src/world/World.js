import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Collision } from './Collision.js';
import { groundTexture, concreteTexture, rng } from './Procedural.js';

/** Owns the scene, static map, colliders and the entity list. */
export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.collision = new Collision();
    this.entities = new Set();
    this.decor = [];
    this._build();
  }

  _build() {
    const c = CONFIG.world;
    const size = c.halfSize * 2;
    this.scene.background = new THREE.Color(c.fogColor);
    this.scene.fog = new THREE.FogExp2(c.fogColor, c.fogDensity);

    this.scene.add(new THREE.HemisphereLight(0xe4e8ec, 0x50555b, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size + 400, size + 400),
      new THREE.MeshLambertMaterial({ map: groundTexture(size + 400) }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this._concrete = new THREE.MeshLambertMaterial({ map: concreteTexture(), color: 0xb8bdc2 });
    const rand = rng(c.seed);

    // Interior buildings (solid, used as cover for dodging).
    let placed = 0; let guard = 0;
    while (placed < 16 && guard++ < 400) {
      const w = 6 + rand() * 10; const d = 6 + rand() * 10; const h = 4 + rand() * 10;
      const x = (rand() * 2 - 1) * (c.halfSize - 20);
      const z = (rand() * 2 - 1) * (c.halfSize - 20);
      if (Math.hypot(x, z) < c.clearSpawnRadius + Math.max(w, d)) continue;
      this._staticBox(x, z, w, d, h, true);
      placed++;
    }
    // Skyline beyond the arena edge (visual only, mostly swallowed by fog).
    for (let i = -6; i <= 6; i++) {
      const o = c.halfSize + 14;
      const w = 16 + rand() * 8; const h = 10 + rand() * 18;
      this._staticBox(i * 20, -o, w, 10, h, false);
      this._staticBox(i * 20, o, w, 10, h, false);
      this._staticBox(-o, i * 20, 10, w, h, false);
      this._staticBox(o, i * 20, 10, w, h, false);
    }
    this._waterTower(58, -72);
  }

  _staticBox(x, z, w, d, h, solid) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._concrete);
    m.position.set(x, h / 2, z);
    this.scene.add(m);
    this.decor.push(m);
    if (solid) this.collision.add({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
  }

  _waterTower(x, z) {
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const leg = new THREE.CylinderGeometry(0.25, 0.25, 12, 8);
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const l = new THREE.Mesh(leg, dark); l.position.set(lx, 6, lz); g.add(l);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 20), dark); tank.position.y = 14.5; g.add(tank);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2, 20), dark); roof.position.y = 18; g.add(roof);
    this.scene.add(g);
    this.collision.add({ minX: x - 2.3, maxX: x + 2.3, minZ: z - 2.3, maxZ: z + 2.3, top: 12 });
  }

  add(entity) {
    this.entities.add(entity);
    this.scene.add(entity.object3d);
    entity.world = this;
    entity.onAdded();
    return entity;
  }
  remove(entity) {
    if (!this.entities.delete(entity)) return;
    this.scene.remove(entity.object3d);
    entity.onRemoved();
  }
  ofType(type) { return [...this.entities].filter(e => e.type === type); }
  count(type) { let n = 0; for (const e of this.entities) if (e.type === type) n++; return n; }
  clear(type) { for (const e of this.ofType(type)) this.remove(e); }

  /** Meshes a spawn ray can land on. */
  aimTargets() {
    const t = [this.ground, ...this.decor];
    for (const e of this.entities) if (e.type === 'prop') t.push(e.pickMesh);
    return t;
  }
  /** Meshes the remove tool can pick. */
  pickables() { return [...this.entities].filter(e => e.pickMesh).map(e => e.pickMesh); }

  /** Shove nextbots out of a circle (used when the player respawns). */
  pushNextbotsFrom(x, z, radius) {
    for (const e of this.entities) {
      if (e.type !== 'nextbot') continue;
      const dx = e.s.x - x; const dz = e.s.z - z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < radius) { e.s.x = x + (dx / d) * radius; e.s.z = z + (dz / d) * radius; e.s.vx = 0; e.s.vz = 0; }
    }
  }

  update(dt, ctx) {
    for (const e of [...this.entities]) e.update(dt, ctx);
    const bots = this.ofType('nextbot');
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i].s; const b = bots[j].s;
        const dx = b.x - a.x; const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = bots[i].radius + bots[j].radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }
  }
}
