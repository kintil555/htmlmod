import * as THREE from 'three';

/**
 * Base class for everything placed in the World.
 * Subclass, set `type`, put visuals in `object3d`, implement update(dt, ctx).
 * Optional: set `pickMesh` (Mesh the Remove tool can hit) and `displayName`.
 * ctx = { player, camera }. Shared geometry/materials must be cached at module level, never per instance.
 */
export class Entity {
  constructor(type) {
    this.type = type;
    this.object3d = new THREE.Group();
    this.world = null;
    this.pickMesh = null;
    this.displayName = type;
  }
  onAdded() {}
  onRemoved() {}
  update(_dt, _ctx) {}
}
