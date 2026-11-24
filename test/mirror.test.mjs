import assert from 'node:assert/strict';
import { Matrix4, Vector4, WebGPUCoordinateSystem } from '../vendor/three.core.js';

// Same maths as the reversed-depth branch in ReflectorBaseNode.updateBefore (vendor/three.webgpu.nodes.js).
function oblique(P, clipPlane) {
  const q = new Vector4(Math.sign(clipPlane.x), Math.sign(clipPlane.y), 0, 1).applyMatrix4(new Matrix4().copy(P).invert());
  const k = -1 / clipPlane.dot(q);
  const e = P.elements;
  e[2] = e[3] + k * clipPlane.x; e[6] = e[7] + k * clipPlane.y; e[10] = e[11] + k * clipPlane.z; e[14] = e[15] + k * clipPlane.w;
  return P;
}
const depth = (P, x, y, z) => { const c = new Vector4(x, y, z, 1).applyMatrix4(P); return c.z / c.w; };

const near = 0.1; const far = 600;
const P0 = new Matrix4().makePerspective(-0.1, 0.1, 0.06, -0.06, near, far, WebGPUCoordinateSystem, true);
assert.ok(Math.abs(depth(P0, 0, 0, -near) - 1) < 1e-4 && Math.abs(depth(P0, 0, 0, -far)) < 1e-4, 'reversed: near=1, far=0');

// The reflector plane has the camera on its negative side (C.w < 0) and the kept geometry on its positive side.
// Plane z = -5: geometry beyond it (z < -5) must stay visible.
const P = oblique(P0.clone(), new Vector4(0, 0, -1, -5));
assert.ok(Math.abs(depth(P, 0, 0, -5) - 1) < 1e-4, 'on the plane: depth 1 (new near)');
assert.ok(depth(P, 0, 0, -20) > 0 && depth(P, 0, 0, -20) < 1, 'beyond the plane: inside depth range');
assert.ok(depth(P, 0, 0, -2) > 1, 'before the plane: beyond near, clipped');
const d1 = depth(P, 0, 0, -10); const d2 = depth(P, 0, 0, -50);
assert.ok(d1 > d2, 'nearer surface keeps the larger reversed depth');

// Tilted plane through (0,0,-8).
const n = new Vector4(0, 0.6, -0.8, 0); n.w = -(n.z * -8);
const T = oblique(P0.clone(), n);
assert.ok(Math.abs(depth(T, 0, 0, -8) - 1) < 1e-4, 'tilted plane maps to depth 1');
assert.ok(depth(T, 0, 0, -30) < 1 && depth(T, 0, 0, -30) > 0, 'beyond tilted plane is visible');
assert.ok(depth(T, 0, 0, -3) > 1, 'before tilted plane is clipped');
console.log('mirror tests passed');
