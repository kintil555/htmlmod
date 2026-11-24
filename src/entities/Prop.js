import * as THREE from 'three';
import { Entity } from './Entity.js';
import { concreteTexture } from '../world/Procedural.js';

let concrete = null;
const geos = new Map();
const mats = new Map();
const edgeGeos = new Map();
const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x15181c });

function shared(def) {
  concrete ??= concreteTexture();
  const key = def.size.join('x');
  if (!geos.has(key)) {
    const g = new THREE.BoxGeometry(...def.size);
    geos.set(key, g);
    edgeGeos.set(key, new THREE.EdgesGeometry(g));
  }
  if (!mats.has(def.color)) mats.set(def.color, new THREE.MeshLambertMaterial({ map: concrete, color: def.color }));
  return { geo: geos.get(key), edges: edgeGeos.get(key), mat: mats.get(def.color) };
}

/** Static solid box prop resting on the surface at (x, y, z). Definition: id, name, size:[w,h,d], color. Axis-aligned only. */
export class Prop extends Entity {
  constructor(def, x, z, y = 0) {
    super('prop');
    this.castsShadow = true;
    this.def = def;
    this.displayName = def.name;
    const [w, h, d] = def.size;
    const { geo, edges, mat } = shared(def);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.add(new THREE.LineSegments(edges, EDGE_MAT));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.y = h / 2;
    this.mesh.userData.entity = this;
    this.pickMesh = this.mesh;
    this.object3d.add(this.mesh);
    this.object3d.position.set(x, y, z);
    this.box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom: y, top: y + h };
  }
  onAdded() { this.world.collision.add(this.box); }
  onRemoved() { this.world.collision.remove(this.box); }
}
