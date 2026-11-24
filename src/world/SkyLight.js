import * as THREE from 'three/webgpu';
import { texture, vec2, positionWorld, normalWorld, smoothstep, mix } from 'three/tsl';
import { CONFIG } from '../config.js';

/**
 * Sky visibility without a light probe grid: the map's triangles are splatted top-down into a roof-height texture
 * (highest surface per x/z cell). A shaded point is "under a roof" when that height is above the point, so rooms,
 * tunnels and overhangs lose sky ambient light while the open ground and roofs keep it. Sun light is untouched
 * (it is shadow mapped), only ambient/hemisphere/sky reflection is scaled, through the material's `aoNode`.
 */

/** One box-blur pass along rows (stride 1) or columns (stride n), edge clamped, O(1) per cell via a sliding sum. */
function boxBlur(src, dst, w, h, w0, vertical) {
  const len = vertical ? h : w; const lines = vertical ? w : h; const step = vertical ? w : 1; const lineStep = vertical ? 1 : w;
  const inv = 1 / (2 * w0 + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStep;
    let sum = 0;
    for (let k = -w0; k <= w0; k++) sum += src[o + Math.min(len - 1, Math.max(0, k)) * step];
    for (let i = 0; i < len; i++) {
      dst[o + i * step] = sum * inv;
      sum += src[o + Math.min(len - 1, i + w0 + 1) * step] - src[o + Math.max(0, i - w0) * step];
    }
  }
}

/** Gaussian-like blur (three box passes each way) with standard deviation `sigma` cells. Smooths the grid out of the roof field. */
function blurField(field, nx, nz, sigma) {
  const w0 = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const tmp = new Float32Array(field.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(field, tmp, nx, nz, w0, false);
    boxBlur(tmp, field, nx, nz, w0, true);
  }
}

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

  // Blur: the border between open sky and roof becomes a smooth ramp (no grid steps), sampled with one linear tap in the shader.
  blurField(roof, nx, nz, S.blur / cell / 2);

  const half = new Uint16Array(roof.length);
  for (let i = 0; i < roof.length; i++) half[i] = THREE.DataUtils.toHalfFloat(roof[i]);
  const tex = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { texture: tex, minX, minZ, sizeX, sizeZ, minY, rangeY };
}

/** Shader node, 0..1: how much of the sky ambient reaches this surface (1 in the open, `minAmbient` under a roof). */
export function skyAmbientNode(field) {
  const S = CONFIG.lighting.skylight;
  // Test a point just off the surface along its normal: ceilings test below themselves, outer walls test outside.
  const p = positionWorld.add(normalWorld.mul(S.offset));
  const uv = vec2(p.x.sub(field.minX).div(field.sizeX), p.z.sub(field.minZ).div(field.sizeZ));
  const roofY = texture(field.texture, uv).r.mul(field.rangeY).add(field.minY);
  const open = smoothstep(0, S.softness, p.y.sub(roofY).add(S.margin));
  return mix(S.minAmbient, 1, open);
}
