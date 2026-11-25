import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Collision } from './Collision.js';
import { collectTriangles } from './MapLoader.js';
import { NavGraph } from './NavGraph.js';
import { SkyAmbient } from './SkyAmbient.js';
import { Water } from './Water.js';
import { events } from '../core/Events.js';

/** Owns the scene, the baked map (render meshes + colliders) and the entity list. */
export class World {
  /** @param map result of buildMap() (see MapLoader.js) */
  constructor(map) {
    this.scene = new THREE.Scene();
    this.map = map;
    this.bounds = map.bounds;
    this.spawn = map.spawn;
    this.textures = map.textures;
    this.entities = new Set();
    this.decor = map.group.children.filter(m => !m.userData.noAim);
    this.scene.add(map.group);
    this.collision = new Collision({ step: CONFIG.player.stepHeight, floorY: map.bounds.minY - CONFIG.world.floorDepth });
    const triangles = collectTriangles(map.group);
    for (const { world, index } of triangles) this.collision.addTriangles(world, index);
    SkyAmbient.bake(triangles, map.bounds);
    /** The pool (Water.js) when the map has one: depth, ripples, swimming. Null otherwise. */
    this.water = map.water ? Water : null;
    if (map.water) {
      Water.bake(map.water, this.collision);
      if (Water.reflectTarget) this.scene.add(Water.reflectTarget);
    }
    this.nav = null;
  }

  /** Bakes the nextbot navigation graph from the map's collision (any map, automatic). Call once after construction. */
  async buildNav(onProgress) {
    const n = CONFIG.nextbot;
    this.nav = new NavGraph(this.collision, this.bounds, n.nav, { bodyHeight: n.bodyHeight, jumpSpeed: n.jumpSpeed, gravity: n.gravity, clearance: n.clearance, step: n.stepHeight });
    await this.nav.bake(onProgress);
  }

  /** Keeps a circle of radius r inside the map's XZ bounds. */
  clamp(p, r = 0) {
    const b = this.bounds;
    p.x = Math.max(b.minX + r, Math.min(b.maxX - r, p.x));
    p.z = Math.max(b.minZ + r, Math.min(b.maxZ - r, p.z));
  }

  add(entity) {
    this.entities.add(entity);
    this.scene.add(entity.object3d);
    entity.world = this;
    entity.onAdded();
    events.emit('game:entity:add', entity);
    return entity;
  }
  remove(entity) {
    if (!this.entities.delete(entity)) return;
    this.scene.remove(entity.object3d);
    entity.onRemoved();
    events.emit('game:entity:remove', entity);
  }
  ofType(type) { return [...this.entities].filter(e => e.type === type); }
  count(type) { let n = 0; for (const e of this.entities) if (e.type === type) n++; return n; }
  clear(type) { for (const e of this.ofType(type)) this.remove(e); }

  /** Meshes a spawn ray can land on. */
  aimTargets() {
    const t = [...this.decor];
    for (const e of this.entities) if (e.type === 'prop') t.push(e.pickMesh);
    return t;
  }
  /** Meshes the remove tool can pick. */
  pickables() { return [...this.entities].filter(e => e.pickMesh).map(e => e.pickMesh); }

  /** Shove nextbots out of a circle (used when the player respawns). */
  pushNextbotsFrom(x, z, radius) {
    for (const e of this.entities) {
      if (e.type !== 'nextbot' || e.remote) continue;
      const dx = e.s.x - x; const dz = e.s.z - z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < radius) { e.s.x = x + (dx / d) * radius; e.s.z = z + (dz / d) * radius; e.s.vx = 0; e.s.vz = 0; }
    }
  }

  update(dt, ctx) {
    // ctx.player is the local player; ctx.target is who the nextbots chase (multiplayer host: the nearest living player). ctx.chase false: nextbots are only mirrored.
    const target = ctx.target ?? ctx.player;
    if (ctx.chase !== false && this.nav && this.count('nextbot')) this.nav.updateFlow(dt, target.pos.x, target.pos.y, target.pos.z);
    for (const e of [...this.entities]) e.update(dt, ctx);
    this.water?.update(dt, ctx, this.entities);
    const bots = this.ofType('nextbot').filter(b => !b.remote);
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
