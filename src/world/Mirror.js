import * as THREE from 'three/webgpu';
import { reflector, vec4, color } from 'three/tsl';
import { CONFIG } from '../config.js';

const KEY_STEP = 0.02;

/** Splits a triangle soup into coplanar groups (same normal and plane offset). Returns [{normal, origin, points:[Vector3]}]. */
function planarGroups(pos, index) {
  const groups = new Map();
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const triCount = index ? index.length / 3 : pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const i = [0, 1, 2].map(k => (index ? index[t * 3 + k] : t * 3 + k) * 3);
    a.fromArray(pos, i[0]); b.fromArray(pos, i[1]); c.fromArray(pos, i[2]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const key = [n.x, n.y, n.z, n.dot(a)].map(v => Math.round(v / KEY_STEP)).join(',');
    if (!groups.has(key)) groups.set(key, { normal: n.clone(), points: [] });
    groups.get(key).points.push(a.clone(), b.clone(), c.clone());
  }
  return [...groups.values()];
}

/**
 * Turns the triangles of a mirror material into planar reflectors (TSL `reflector()` node: renders the scene a
 * second time from the mirrored camera). Works for any flat glass/mirror pane at any orientation, one Reflector per plane,
 * plus a flipped twin so the pane also mirrors from its back. A reflector only renders while its pane is drawn
 * (on screen and front-facing), so unseen mirrors cost nothing. Geometry stays in the caller's local space.
 */
export function buildMirrors(pos, index, name = 'mirror') {
  const M = CONFIG.lighting.mirror;
  const tint = color(M.color);
  const out = [];
  for (const g of planarGroups(pos, index)) {
    const origin = new THREE.Vector3();
    for (const p of g.points) origin.add(p);
    origin.divideScalar(g.points.length);
    const up = Math.abs(g.normal.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = up.clone().cross(g.normal).normalize();
    const bitangent = g.normal.clone().cross(tangent);
    for (const side of [1, -1]) {
      const n = g.normal.clone().multiplyScalar(side);
      const bt = bitangent.clone().multiplyScalar(side);
      const verts = [];
      for (let i = 0; i < g.points.length; i++) {
        const d = g.points[i].clone().sub(origin);
        verts.push(d.dot(tangent), d.dot(bt), 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const refl = reflector({ resolutionScale: M.resolution, bounces: false, samples: M.multisample });
      const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
      material.colorNode = vec4(refl.rgb.mul(tint), 1);
      const r = new THREE.Mesh(geo, material);
      r.add(refl.target);
      r.name = name;
      r.position.copy(origin).addScaledVector(n, M.offset);
      r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, bt, n));
      r.updateMatrix();
      r.matrixAutoUpdate = false;
      r.userData.collide = side === 1;
      out.push(r);
    }
  }
  return out;
}
