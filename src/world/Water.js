import * as THREE from 'three/webgpu';
import {
  texture, uniform, positionWorld, cameraPosition, cameraViewMatrix, time, vec2, vec3, vec4, float, color, smoothstep, pow, max, saturate,
  dot, normalize, length, reflect, sin, cos, exp, select, mx_noise_float,
} from 'three/tsl';
import { CONFIG } from '../config.js';
import { SkyAmbient } from './SkyAmbient.js';
import { WaterSim, blur3 } from './WaterSim.js';

/**
 * Water for the map's `water` materials. One pool (a flat quad) is turned into:
 *  - a depth field baked from the map's collision (how deep the water is under every point; 0 = land), used for clarity, colour,
 *    shoreline foam, swimming and "is the camera under water";
 *  - a ripple field (WaterSim) that players and nextbots disturb when they wade, swim or dive in, uploaded as a (height, foam) texture;
 *  - a node material: animated wave normals + ripples, depth-based colour/opacity (clear in the shallows), Fresnel sky reflection,
 *    shoreline + splash foam, sun glitter, and a Snell-window look from below.
 * The camera-under-water fog is a post effect (PostFx.js) driven by `Water.uniforms`.
 * All numbers come from CONFIG.water. Without a pool nothing here costs anything: uniforms stay 0 and update() returns at once.
 */
const W = CONFIG.water;
const L = CONFIG.lighting;
const U = W.under;

const makeTex = (format) => {
  const t = new THREE.DataTexture(new Uint16Array(format === THREE.RGFormat ? 2 : 1), 1, 1, format, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};
const simTex = makeTex(THREE.RGFormat);
const depthTex = makeTex(THREE.RedFormat);

const origin = uniform(new THREE.Vector2());
const invSize = uniform(new THREE.Vector2(1, 1));
const texel = uniform(new THREE.Vector2(1, 1));
const cellU = uniform(1);

const uniforms = {
  /** 1 while the camera is under the surface (eased), else 0. */
  under: uniform(0),
  /** Camera depth below the surface in world units. */
  camDepth: uniform(0),
  fogColor: uniform(new THREE.Vector3()),
  absorb: uniform(new THREE.Vector3(...U.absorb)),
};

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - L.sun.elevation), THREE.MathUtils.degToRad(L.sun.azimuth));
const sunColor = new THREE.Color(L.sun.color);

const lerp = (a, b, t) => a.add(b.sub(a).mul(t));
const S = { ready: false, info: null, sim: null, depth: null, nx: 0, nz: 0, cell: 1, data: null, under: 0, prev: new WeakMap(), material: null };
const fogShallow = new THREE.Color(U.shallow);
const fogDeep = new THREE.Color(U.deep);

function buildMaterial() {
  const p = positionWorld.xz;
  const toCam = cameraPosition.sub(positionWorld);
  const dist = length(toCam);
  const viewW = normalize(toCam);
  const below = viewW.y.lessThan(0);
  const wuv = p.sub(origin).mul(invSize);

  // Wave slopes: a few directional sines plus a noise detail layer, fading with distance so far water does not shimmer.
  let gx = float(0); let gz = float(0);
  for (const [dx, dz, k, speed, amp] of W.waves.layers) {
    const l = Math.hypot(dx, dz);
    const c = cos(dot(p, vec2(dx / l, dz / l)).mul(k).add(time.mul(speed))).mul(amp * k);
    gx = gx.add(c.mul(dx / l)); gz = gz.add(c.mul(dz / l));
  }
  const f = W.waves.detailScale; const e = 0.12;
  const nAt = (ox, oz) => mx_noise_float(vec3(p.x.add(ox).mul(f), p.y.add(oz).mul(f), time.mul(0.35)));
  const n0 = nAt(0, 0);
  gx = gx.add(nAt(e, 0).sub(n0).div(e * f).mul(W.waves.detail));
  gz = gz.add(nAt(0, e).sub(n0).div(e * f).mul(W.waves.detail));
  const lod = float(1).sub(smoothstep(W.waves.fadeNear, W.waves.fadeFar, dist).mul(1 - W.waves.farKeep));
  gx = gx.mul(lod); gz = gz.mul(lod);

  // Ripple slopes from the simulated height field (central differences).
  const hAt = (ox, oz) => texture(simTex, wuv.add(texel.mul(vec2(ox, oz)))).r;
  const rx = hAt(1, 0).sub(hAt(-1, 0)).div(cellU.mul(2)).mul(W.waves.rippleGain);
  const rz = hAt(0, 1).sub(hAt(0, -1)).div(cellU.mul(2)).mul(W.waves.rippleGain);
  const nW = normalize(vec3(gx.add(rx).negate(), 1, gz.add(rz).negate()));
  const nF = select(below, nW.negate(), nW);
  const cosV = saturate(dot(nF, viewW));

  // Depth: clarity and colour. Shallow = see-through, deep = darker and more opaque.
  const depth = texture(depthTex, wuv).r;
  const body = float(1).sub(exp(depth.mul(-W.absorb)));
  const tint = float(1).sub(exp(depth.mul(-W.colorDepth)));
  const bodyColor = lerp(vec3(color(W.color.shallow)), vec3(color(W.color.deep)), tint);
  const fres = pow(float(1).sub(cosV), 5).mul(0.98).add(0.02);

  // Foam: lapping band along the shore + splash/crest foam from the ripple field, broken up by noise.
  const nf = W.foam.noiseScale;
  const slow = mx_noise_float(vec3(p.x.mul(nf), p.y.mul(nf), time.mul(W.foam.noiseSpeed))).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(p.x.mul(W.foam.fineScale), p.y.mul(W.foam.fineScale), time.mul(0.6))).mul(0.5).add(0.5);
  const lap = sin(time.mul(W.foam.shoreSpeed).add(slow.mul(6.2832))).mul(0.35).add(0.65);
  const edge = lap.mul(W.foam.shoreWidth);
  const shore = float(1).sub(smoothstep(edge.mul(0.3), edge, depth)).mul(smoothstep(0.25, 0.6, fine));
  const splash = smoothstep(0.1, 0.6, texture(simTex, wuv).g.mul(fine.mul(0.8).add(0.6)));
  const foam = max(shore, splash);

  // Sun glitter: the sun's reflection (sharp core + a sparkling road) over the wave normals; none indoors.
  const refl = reflect(viewW.negate(), nF);
  const sd = max(dot(refl, vec3(sunDir.x, sunDir.y, sunDir.z)), 0);
  const G = W.glitter;
  const sparkle = smoothstep(G.threshold[0], G.threshold[1], mx_noise_float(vec3(p.x.mul(G.freq), p.y.mul(G.freq), time.mul(G.speed))).mul(0.5).add(0.5));
  const glint = pow(sd, G.pathPower).mul(G.path).mul(sparkle).add(pow(sd, G.corePower).mul(G.core));
  const glitter = vec3(sunColor.r, sunColor.g, sunColor.b).mul(glint).mul(SkyAmbient.specular).mul(select(below, float(0), float(1)));

  const aboveColor = lerp(bodyColor, vec3(color(W.color.foam)), foam);
  const aboveOpacity = max(max(body.mul(W.maxOpacity - W.minOpacity).add(W.minOpacity), fres), max(foam.mul(W.foam.opacity), saturate(max(glitter.x, max(glitter.y, glitter.z)).mul(G.opacityGain))));

  // From below: a clear window straight up, mirror-like beyond the critical angle.
  const tir = float(1).sub(smoothstep(U.windowCos[0], U.windowCos[1], cosV));
  const belowColor = uniforms.fogColor;
  const belowOpacity = lerp(float(U.windowOpacity), float(U.mirrorOpacity), tir);

  const material = new THREE.MeshPhysicalNodeMaterial({ transparent: true, roughness: W.roughness, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  material.colorNode = vec4(select(below, belowColor, aboveColor), 1);
  material.opacityNode = select(below, belowOpacity, aboveOpacity);
  material.emissiveNode = select(below, belowColor.mul(U.tint), glitter);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nF, 0)).xyz);
  // Indoor pools must not mirror a sky they cannot see: the Fresnel reflection follows sky visibility.
  material.aoNode = SkyAmbient.node;
  material.specularIntensityNode = SkyAmbient.specular;
  return material;
}

/** Bilinear depth at world (x, z); 0 outside the pool. */
function depthAt(x, z) {
  if (!S.ready) return 0;
  const fx = (x - S.info.minX) / S.cell - 0.5; const fz = (z - S.info.minZ) / S.cell - 0.5;
  if (fx < -0.5 || fz < -0.5 || fx > S.nx - 0.5 || fz > S.nz - 0.5) return 0;
  const i = Math.max(0, Math.min(S.nx - 2, Math.floor(fx))); const j = Math.max(0, Math.min(S.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)); const tz = Math.max(0, Math.min(1, fz - j));
  const d = S.depth; const k = j * S.nx + i;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + S.nx] * (1 - tx) + d[k + S.nx + 1] * tx) * tz;
}

/** Surface height at (x, z) when there is water there, else null. */
function surfaceAt(x, z) {
  return S.ready && depthAt(x, z) > W.minDepth ? S.info.y : null;
}

/** Wakes, entry/exit splashes for one body. `feet` = lowest point, speed = horizontal speed. */
function disturb(key, x, z, feet, vy, speed, radius, height, dt) {
  const surf = surfaceAt(x, z);
  const prev = S.prev.get(key);
  S.prev.set(key, feet);
  if (surf === null) return;
  const R = W.ripple;
  const lx = x - S.info.minX; const lz = z - S.info.minZ;
  const wasBelow = prev !== undefined && prev < surf;
  const isBelow = feet < surf;
  if (prev !== undefined && wasBelow !== isBelow) {
    const amount = Math.max(R.splashMin, Math.min(R.splashMax, Math.max(-vy * R.splashScale, speed * R.splashSpeed))) * (isBelow ? 1 : R.exit);
    S.sim.splat(lx, lz, R.splashCells, amount, R.foam);
  }
  if (isBelow && feet + height > surf && speed > 0.5) {
    S.sim.splat(lx, lz, Math.max(R.wakeCells, radius * 1.3 / S.cell), speed * R.wake * dt, speed > R.wakeFoamSpeed ? R.foam * 0.5 : 0);
  }
}

export const Water = {
  uniforms,

  /** The shared water material (built on first use). */
  material() { return (S.material ??= buildMaterial()); },

  /**
   * Bakes the depth field from the map's collision and starts the ripple sim. `info` = { minX, maxX, minZ, maxZ, y } in world units
   * (the pool quad's bounds and surface height, from MapLoader). Call once, after the colliders exist and before the first render.
   */
  bake(info, collision) {
    if (!info) return;
    const sx = info.maxX - info.minX; const sz = info.maxZ - info.minZ;
    const cell = Math.max(sx, sz) / W.grid;
    const nx = Math.ceil(sx / cell); const nz = Math.ceil(sz / cell);
    const raw = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const g = collision.groundHeight(info.minX + (i + 0.5) * cell, info.minZ + (j + 0.5) * cell, 0.05, info.y + W.landReach, 0);
        raw[j * nx + i] = g > info.y ? 0 : Math.min(W.maxDepth, info.y - g);
      }
    }
    const depth = blur3(raw, nx, nz);
    const half = new Uint16Array(depth.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(depth[i]);
    depthTex.image = { data: half, width: nx, height: nz };
    depthTex.needsUpdate = true;
    S.data = new Uint16Array(nx * nz * 2);
    simTex.image = { data: S.data, width: nx, height: nz };
    simTex.needsUpdate = true;
    origin.value.set(info.minX, info.minZ);
    invSize.value.set(1 / (nx * cell), 1 / (nz * cell));
    texel.value.set(1 / nx, 1 / nz);
    cellU.value = cell;
    Object.assign(S, { info, nx, nz, cell, depth });
    S.sim = new WaterSim({ nx, nz, cell, depth, ...CONFIG.water.sim });
    S.ready = true;
  },

  /** Surface height at (x, z) where there is water (deeper than CONFIG.water.minDepth), else null. */
  surfaceAt,

  /** Fraction (0..1) of a body of `height` standing with its feet at `pos` that is under water. */
  submersion(pos, height) {
    const s = surfaceAt(pos.x, pos.z);
    return s === null ? 0 : Math.max(0, Math.min(1, (s - pos.y) / height));
  },

  /** Per frame: ripples from the player and nextbots, the ripple sim, and the camera-under-water state for PostFx. */
  update(dt, { player, camera }, entities) {
    if (!S.ready) return;
    if (!player.frozen) disturb(player, player.pos.x, player.pos.z, player.pos.y, player.vel.y, player.speed, player.radius, CONFIG.player.height, dt);
    for (const e of entities) {
      if (e.type === 'nextbot') disturb(e, e.s.x, e.s.z, e.y, e.vy, Math.hypot(e.s.vx, e.s.vz), e.radius, CONFIG.nextbot.bodyHeight, dt);
    }
    if (S.sim.advance(dt)) {
      S.sim.fill(S.data, THREE.DataUtils.toHalfFloat);
      simTex.needsUpdate = true;
    }

    const cam = camera.position;
    const surf = surfaceAt(cam.x, cam.z);
    const target = surf !== null && cam.y < surf ? 1 : 0;
    S.under += (target - S.under) * Math.min(1, dt * U.blendRate);
    if (S.under < 0.002 && target === 0) S.under = 0;
    uniforms.under.value = S.under;
    const d = target ? surf - cam.y : 0;
    uniforms.camDepth.value = d;
    const c = fogDeep.clone().lerp(fogShallow, Math.exp(-d * U.depthFade));
    uniforms.fogColor.value.set(c.r, c.g, c.b);
  },
};
