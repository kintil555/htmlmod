import * as THREE from 'three/webgpu';
import { mix } from 'three/tsl';
import { CONFIG } from '../config.js';
import { Assets } from '../core/Assets.js';
import { buildMirrors } from './Mirror.js';
import { fresnel } from './Fresnel.js';
import { buildRoofField, skyAmbientNode } from './SkyLight.js';

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

/** First surface class whose pattern matches the baked material name (CONFIG.lighting.surfaces), or the fallback. */
export function surfaceFor(name) {
  const L = CONFIG.lighting;
  return L.surfaces.find(c => c.match.test(name)) ?? { ...L.material, specular: 0.5, env: 1 };
}

function makeMaterial(m, texture) {
  const L = CONFIG.lighting;
  if (m.water) {
    const water = new THREE.MeshPhysicalNodeMaterial({
      color: L.water.color, transparent: true, roughness: L.water.roughness,
      metalness: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    water.opacityNode = mix(L.water.opacity, 1, fresnel(L.water.power));
    return water;
  }
  const surface = surfaceFor(m.name);
  return new THREE.MeshPhysicalNodeMaterial({
    map: texture,
    color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]),
    roughness: surface.roughness,
    metalness: surface.metalness,
    specularIntensity: surface.specular,
    envMapIntensity: surface.env,
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
 * { group, scale, textures, bounds, spawn, credit } in game units. Collision is derived from the meshes
 * themselves (see collectTriangles); each material's `collide` flag (set by the baker) opts it in or out.
 */
export function buildMap({ def, meta, buffer }) {
  const scale = CONFIG.player.eyeHeight / def.eyeHeight;
  const group = new THREE.Group();
  group.name = def.id;
  group.scale.setScalar(scale);
  const textures = new Set();
  const solids = []; // meshes that can roof something over the player: they feed the sky-visibility field

  for (const m of meta.materials) {
    if (m.mirror) {
      const pos = new Float32Array(buffer, m.pos, m.vertices * 3);
      const idx = new (m.indexBytes === 2 ? Uint16Array : Uint32Array)(buffer, m.idx, m.indices);
      for (const r of buildMirrors(pos, idx, m.name)) group.add(r);
      continue;
    }
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
    mesh.userData.collide = m.collide;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    if (!m.water && !m.decal && m.collide) solids.push(mesh);
  }
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  group.updateMatrixWorld(true);

  const b = meta.bounds;
  const worldBounds = { minX: b.min[0] * scale, maxX: b.max[0] * scale, minY: b.min[1] * scale, maxY: b.max[1] * scale, minZ: b.min[2] * scale, maxZ: b.max[2] * scale };

  // Covered places get little sky ambient light (see SkyLight.js); every opaque map material shares one node.
  const skyField = buildRoofField(solids, scale, worldBounds);
  const skyAmbient = skyAmbientNode(skyField);
  group.traverse(o => { if (o.isMesh && !o.userData.noAim && o.material?.isMeshPhysicalNodeMaterial) o.material.aoNode = skyAmbient; });

  return {
    group, scale, textures: [...textures],
    bounds: worldBounds,
    spawn: { x: def.spawn.x * scale, y: def.spawn.y * scale, z: def.spawn.z * scale, yaw: def.spawn.yaw },
    credit: meta.credit,
  };
}

/**
 * World-space triangles of every collidable mesh under `root` (userData.collide !== false).
 * This is the automatic hitbox: any model added to the scene can be made solid with Collision.addTriangles.
 */
export function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const chunks = [];
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || o.userData.collide === false) return;
    const pos = o.geometry.getAttribute('position'); const index = o.geometry.index;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); world.set([v.x, v.y, v.z], i * 3); }
    chunks.push({ world, index: index ? index.array : null });
  });
  return chunks;
}
