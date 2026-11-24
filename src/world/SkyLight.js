import * as THREE from 'three/webgpu';
import { texture3D, vec3, positionWorld, normalWorld, smoothstep, mix } from 'three/tsl';
import { CONFIG } from '../config.js';

/**
 * Sky visibility without a light probe grid: the map's triangles are splatted top-down into a roof-height texture
 * (highest surface per x/z cell). A shaded point is "under a roof" when that height is above the point, so rooms,
 * tunnels and overhangs lose sky ambient light while the open ground and roofs keep it. Sun light is untouched
 * (it is shadow mapped), only ambient/hemisphere/sky reflection is scaled, through the material's `aoNode`.
 */

/** meshes: THREE.Mesh list in a space where `scale` maps local units to world. Returns the roof-height field. */
export function buildRoofField(meshes, scale, bounds) {
  const S = CONFIG.lighting.skylight;
  const minX = bounds.minX - 1; const minZ = bounds.minZ - 1; const minY = bounds.minY; const rangeY = Math.max(1e-3, bounds.maxY - bounds.minY);
  const sizeX = bounds.maxX - bounds.minX + 2; const sizeZ = bounds.maxZ - bounds.minZ + 2;
  const cell = Math.max(sizeX, sizeZ) / S.resolution;
  const nx = Math.ceil(sizeX / cell); const nz = Math.ceil(sizeZ / cell);
  const roof = new Float32Array(nx * nz).fill(0);

  const splatPoint = (x, y, z) => {
    const i = Math.floor((x - minX) / cell); const j = Math.floor((z - minZ) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const v = (y - minY) / rangeY;
    if (v > roof[j * nx + i]) roof[j * nx + i] = v;
  };

  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    const idx = mesh.geometry.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
      const ax = pos[a] * scale; const ay = pos[a + 1] * scale; const az = pos[a + 2] * scale;
      const bx = pos[b] * scale; const by = pos[b + 1] * scale; const bz = pos[b + 2] * scale;
      const cx = pos[c] * scale; const cy = pos[c + 1] * scale; const cz = pos[c + 2] * scale;
      splatPoint(ax, ay, az); splatPoint(bx, by, bz); splatPoint(cx, cy, cz);
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue; // vertical triangle: no footprint
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell));
      for (let j = j0; j <= j1; j++) {
        const pz = minZ + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = minX + (i + 0.5) * cell;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const v = (l1 * ay + l2 * by + l3 * cy - minY) / rangeY;
          if (v > roof[j * nx + i]) roof[j * nx + i] = v;
        }
      }
    }
  }

  const ext = voxelExtent(sizeX, sizeZ, rangeY);
  return { texture: buildOpenness(roof, nx, nz, cell, rangeY, ext), minX, minZ, minY, rangeY, ...ext };
}

function voxelExtent(sizeX, sizeZ, rangeY) {
  const v = CONFIG.lighting.skylight.voxel;
  const gx = Math.ceil(sizeX / v); const gz = Math.ceil(sizeZ / v); const gy = Math.min(192, Math.ceil(rangeY / v));
  return { gx, gz, gy, extX: gx * v, extZ: gz * v };
}

/**
 * Sky openness volume: for every voxel, the fraction of the surrounding roof columns (a 2-voxel-wide footprint, so
 * neighbours blend) that lie below the voxel's height, i.e. how much open sky is straight above it. Blurring openness
 * rather than roof height keeps thin roofs and slats open and makes the transition at roof edges a smooth gradient;
 * the GPU's trilinear filter does the rest.
 */
function buildOpenness(roof, nx, nz, cell, rangeY, { gx, gz, gy }) {
  const v = CONFIG.lighting.skylight.voxel;
  const vy = rangeY / gy;
  const data = new Uint16Array(gx * gz * gy);
  const reach = Math.max(1, Math.round(v / cell)); // fine cells either side of the voxel centre
  const heights = new Float32Array((2 * reach + 1) * (2 * reach + 1));
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let j = 0; j < gz; j++) {
    const cj = Math.floor((j + 0.5) * v / cell);
    for (let i = 0; i < gx; i++) {
      const ci = Math.floor((i + 0.5) * v / cell);
      let n = 0;
      for (let dj = -reach; dj <= reach; dj++) {
        const y = Math.min(nz - 1, Math.max(0, cj + dj));
        for (let di = -reach; di <= reach; di++) heights[n++] = roof[y * nx + Math.min(nx - 1, Math.max(0, ci + di))];
      }
      const sorted = heights.subarray(0, n).sort();
      let below = 0;
      for (let k = 0; k < gy; k++) {
        const level = (k + 0.5) * vy / rangeY;
        while (below < n && sorted[below] < level) below++;
        data[k * gx * gz + j * gx + i] = below === n ? one : THREE.DataUtils.toHalfFloat(below / n);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, gx, gz, gy);
  tex.format = THREE.RedFormat; tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Shader node, 0..1: how much of the sky ambient reaches this surface (1 in the open, `minAmbient` fully covered). */
export function skyAmbientNode(field) {
  const S = CONFIG.lighting.skylight;
  // Sample just off the surface along its normal so ceilings read the room below them and outer walls read the air outside.
  const p = positionWorld.add(normalWorld.mul(S.offset));
  const uvw = vec3(p.x.sub(field.minX).div(field.extX), p.z.sub(field.minZ).div(field.extZ), p.y.sub(field.minY).div(field.rangeY));
  const open = smoothstep(0, 1, texture3D(field.texture, uvw).r);
  return mix(S.minAmbient, 1, open);
}
