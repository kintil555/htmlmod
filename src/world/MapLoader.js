import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Assets } from '../core/Assets.js';
import { decodeColliders } from './colliders.js';

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return r;
}

/** Network and decode only (no GPU work): fetches a baked map (tools/bake_map.py) and its textures. */
export async function loadMapData(def, onProgress = () => {}) {
  const meta = await (await fetchOk(`${def.url}map.json`)).json();
  const urls = [...new Set(meta.materials.map(m => m.texture).filter(Boolean))].map(t => def.url + t);
  const total = urls.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);
  const [buffer] = await Promise.all([
    fetchOk(`${def.url}map.bin`).then(r => r.arrayBuffer()).then(b => { tick(); return b; }),
    ...urls.map(u => Assets.texture(u, { flipY: false, repeat: true }).then(tick)),
  ]);
  return { def, meta, buffer };
}

function makeMaterial(m, texture) {
  const L = CONFIG.lighting;
  if (m.water) {
    return new THREE.MeshStandardMaterial({
      color: L.water.color, transparent: true, opacity: L.water.opacity, roughness: L.water.roughness,
      metalness: 0, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]),
    roughness: L.material.roughness,
    metalness: L.material.metalness,
    side: THREE.DoubleSide,
    alphaTest: m.alpha === 'mask' ? 0.5 : 0,
    polygonOffset: m.decal,
    polygonOffsetFactor: m.decal ? -2 : 0,
    polygonOffsetUnits: m.decal ? -2 : 0,
  });
}

/**
 * Builds scene objects and colliders from loaded map data. The whole map is scaled so the map's own
 * player eye height equals CONFIG.player.eyeHeight (map fits the player). Returns:
 * { group, scale, textures, boxes, bounds, spawn, credit } in game units.
 */
export function buildMap({ def, meta, buffer }) {
  const scale = CONFIG.player.eyeHeight / def.eyeHeight;
  const group = new THREE.Group();
  group.name = def.id;
  group.scale.setScalar(scale);
  const textures = new Set();

  for (const m of meta.materials) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, m.pos, m.vertices * 3), 3));
    const n8 = new Int8Array(buffer, m.nrm, m.vertices * 3);
    const n32 = new Float32Array(n8.length);
    for (let i = 0; i < n8.length; i++) n32[i] = n8[i] / 127;
    geo.setAttribute('normal', new THREE.BufferAttribute(n32, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buffer, m.uv, m.vertices * 2), 2));
    const Idx = m.indexBytes === 2 ? Uint16Array : Uint32Array;
    geo.setIndex(new THREE.BufferAttribute(new Idx(buffer, m.idx, m.indices), 1));
    geo.computeBoundingSphere();

    const texture = m.texture ? Assets.get(def.url + m.texture) : null;
    if (texture) textures.add(texture);
    const mesh = new THREE.Mesh(geo, makeMaterial(m, texture));
    mesh.name = m.name;
    mesh.castShadow = !m.water && !m.decal;
    mesh.receiveShadow = !m.water;
    mesh.userData.noAim = m.water;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  group.updateMatrixWorld(true);

  const b = meta.bounds;
  return {
    group, scale, textures: [...textures],
    boxes: decodeColliders(meta.collision, scale),
    bounds: { minX: b.min[0] * scale, maxX: b.max[0] * scale, minY: b.min[1] * scale, maxY: b.max[1] * scale, minZ: b.min[2] * scale, maxZ: b.max[2] * scale },
    spawn: { x: def.spawn.x * scale, y: def.spawn.y * scale, z: def.spawn.z * scale, yaw: def.spawn.yaw },
    credit: meta.credit,
  };
}
