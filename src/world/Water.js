import * as THREE from 'three/webgpu';
import {
  texture, uniform, positionWorld, cameraPosition, cameraViewMatrix, time, vec2, vec3, vec4, float, color, smoothstep, pow, max, saturate,
  dot, normalize, length, reflect, sin, cos, exp, select, mx_noise_float, positionLocal, modelWorldMatrix, fract, min, screenUV, viewportSharedTexture, viewportSafeUV, reflector,
} from 'three/tsl';
import { CONFIG } from '../config.js';
import { SkyAmbient } from './SkyAmbient.js';
import { WaterSim, blur3 } from './WaterSim.js';
import { waveFade, swashLift } from './Shore.js';

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
const SH = W.shore;

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
/** Still surface height and the pool quad's far corner (world units), for geometric thickness and the edge fade. */
const surfY = uniform(0);
const hiCorner = uniform(new THREE.Vector2());

const uniforms = {
  /** 1 while the camera is under the surface (eased), else 0. */
  under: uniform(0),
  /** Camera depth below the surface in world units. */
  camDepth: uniform(0),
  fogColor: uniform(new THREE.Vector3()),
  absorb: uniform(new THREE.Vector3(...U.absorb)),
};
const invScale = uniform(1);
/** 1 while a planar-reflection pass renders (the surface itself must not be in its own mirror image), else 0. */
const inRefl = uniform(0);
/** The reflection plane: add `Water.reflectTarget` to the scene (Water.bake puts it at the still surface height). */
const reflectTarget = { obj: null };
/** Wave clock, shared by the shader and the CPU surface so bodies ride the visible waves. */
const tU = uniform(0);

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - L.sun.elevation), THREE.MathUtils.degToRad(L.sun.azimuth));
const sunColor = new THREE.Color(L.sun.color);

const lerp = (a, b, t) => a.add(b.sub(a).mul(t));
const S = { t: 0, ready: false, info: null, sim: null, depth: null, nx: 0, nz: 0, cell: 1, data: null, under: 0, prev: new WeakMap(), material: null };
const fogShallow = new THREE.Color(U.shallow);
const fogDeep = new THREE.Color(U.deep);

/** Summed wave sines at world xz `p`: height h, slopes gx, gz and the horizontal Gerstner shift sx, sz that sharpens crests (nodes). */
function waveField(p) {
  let h = float(0); let gx = float(0); let gz = float(0); let sx = float(0); let sz = float(0);
  for (const [dx, dz, k, speed, amp] of W.waves.layers) {
    const l = Math.hypot(dx, dz);
    const ph = dot(p, vec2(dx / l, dz / l)).mul(k).add(tU.mul(speed));
    h = h.add(sin(ph).mul(amp));
    const c = cos(ph);
    gx = gx.add(c.mul(amp * k * dx / l)); gz = gz.add(c.mul(amp * k * dz / l));
    sx = sx.add(c.mul(amp * W.waves.choppy * dx / l)); sz = sz.add(c.mul(amp * W.waves.choppy * dz / l));
  }
  return { h, gx, gz, sx, sz };
}

/** Open-water wave amplitude by depth: shrinks in the shallows (keeps `shoreKeep` at the waterline) and dies out over the bank (mirrors Shore.waveFade). */
const ampByDepth = d => smoothstep(0, W.waves.shoreFade, d).mul(1 - W.waves.shoreKeep).add(W.waves.shoreKeep).mul(smoothstep(-W.waves.bankFade, 0.05, d));

/** Swash cycle position 0..1: the phase runs with the signed depth, so crests travel up the slope (mirrors Shore.swashPhase). */
const swashU = (p, d) => {
  let psi = tU.div(SH.period).add(d.mul(SH.phasePerDepth));
  for (const [kx, kz, c] of SH.wobble) psi = psi.add(sin(p.x.mul(kx).add(p.y.mul(kz))).mul(c));
  return fract(psi);
};
const swashEnvAt = d => float(1).sub(smoothstep(SH.shallowStart, SH.shallowEnd, d)).mul(float(1).sub(smoothstep(0, SH.reach, d.negate())));
const bumpAt = u => smoothstep(0, SH.rise, u).mul(float(1).sub(smoothstep(SH.rise, 1, u)));

/** Swash lift: fast uprush onto the bank, slow backwash that draws the waterline below the still level (mirrors Shore.swashLift). */
const swashAt = (p, d) => swashEnvAt(d).mul(SH.height).mul(bumpAt(swashU(p, d)).mul(1 + SH.draw).sub(SH.draw));

function buildMaterial() {
  const p = positionWorld.xz;
  const toCam = cameraPosition.sub(positionWorld);
  const dist = length(toCam);
  const viewW = normalize(toCam);
  const below = viewW.y.lessThan(0);
  const wuv = p.sub(origin).mul(invSize);

  // Waves: directional sines give height and slope (the same sum drives the vertex displacement and the normal), plus a noise detail
  // layer on the normal only. Everything fades out towards the shore (no waves on land) and with distance (less shimmer).
  const depth = texture(depthTex, wuv).r;
  const fade = ampByDepth(depth);
  const wave = waveField(p);
  let gx = wave.gx; let gz = wave.gz;
  const f = W.waves.detailScale; const e = 0.12;
  const nAt = (ox, oz) => mx_noise_float(vec3(p.x.add(ox).mul(f), p.y.add(oz).mul(f), time.mul(0.35)));
  const n0 = nAt(0, 0);
  gx = gx.add(nAt(e, 0).sub(n0).div(e * f).mul(W.waves.detail));
  gz = gz.add(nAt(0, e).sub(n0).div(e * f).mul(W.waves.detail));
  const lod = float(1).sub(smoothstep(W.waves.fadeNear, W.waves.fadeFar, dist).mul(1 - W.waves.farKeep));
  gx = gx.mul(lod).mul(fade); gz = gz.mul(lod).mul(fade);

  // Ripple slopes from the simulated height field (central differences).
  const hAt = (ox, oz) => texture(simTex, wuv.add(texel.mul(vec2(ox, oz)))).r;
  const rg = W.waves.rippleGain * W.waves.splashGain;
  const rx = hAt(1, 0).sub(hAt(-1, 0)).div(cellU.mul(2)).mul(rg);
  const rz = hAt(0, 1).sub(hAt(0, -1)).div(cellU.mul(2)).mul(rg);
  const nW = normalize(vec3(gx.add(rx).negate(), 1, gz.add(rz).negate()));
  const nF = select(below, nW.negate(), nW);
  const cosV = saturate(dot(nF, viewW));

  // Depth: clarity and colour. Shallow = see-through, deep = darker and more opaque.
  // Real water thickness = height of the (lifted) mesh here minus the baked ground, so the waterline is exactly where the mesh meets the ground.
  const lift = wave.h.add(texture(simTex, wuv).r.mul(W.waves.splashGain)).mul(fade).add(swashAt(p, depth));
  const thick = max(positionWorld.y.sub(surfY.sub(depth)), 0);
  const body = float(1).sub(exp(thick.mul(-W.absorb)));
  const tint = float(1).sub(exp(thick.mul(-W.colorDepth)));
  const bodyColor = lerp(vec3(color(W.color.shallow)), vec3(color(W.color.deep)), tint);
  const fres = pow(float(1).sub(cosV), 4).mul(0.95).add(0.04);

  // Foam: lapping band along the shore + splash/crest foam from the ripple field, broken up by noise.
  const nf = W.foam.noiseScale;
  const fine = mx_noise_float(vec3(p.x.mul(W.foam.fineScale), p.y.mul(W.foam.fineScale), time.mul(0.6))).mul(0.5).add(0.5);
  // The uprush front (rising half of the swash cycle) carries the thickest foam; the backwash leaves a thin line.
  const advance = float(1).sub(smoothstep(SH.rise * 0.8, SH.rise * 1.3, swashU(p, depth))).mul(swashEnvAt(depth));
  const edge = advance.mul(W.foam.frontWidth).add(0.35).mul(W.foam.shoreWidth);
  const shore = float(1).sub(smoothstep(edge.mul(0.3), edge, thick)).mul(smoothstep(0.25, 0.6, fine));
  const splash = smoothstep(0.1, 0.6, texture(simTex, wuv).g.mul(fine.mul(0.8).add(0.6)));
  // Crest foam: the highest parts of waves and splashes break white.
  const crest = smoothstep(W.foam.crestStart, W.foam.crestEnd, lift).mul(smoothstep(0.35, 0.7, fine));
  const foam = max(max(shore, splash), crest);

  // Sun glitter: the sun's reflection (sharp core + a sparkling road) over the wave normals; none indoors.
  const refl = reflect(viewW.negate(), nF);
  const sd = max(dot(refl, vec3(sunDir.x, sunDir.y, sunDir.z)), 0);
  const G = W.glitter;
  const sparkle = smoothstep(G.threshold[0], G.threshold[1], mx_noise_float(vec3(p.x.mul(G.freq), p.y.mul(G.freq), time.mul(G.speed))).mul(0.5).add(0.5));
  const glint = pow(sd, G.pathPower).mul(G.path).mul(sparkle).add(pow(sd, G.corePower).mul(G.core));
  const glitter = vec3(sunColor.r, sunColor.g, sunColor.b).mul(glint).mul(SkyAmbient.specular).mul(select(below, float(0), float(1)));

  const aboveColor = lerp(bodyColor, vec3(color(W.color.foam)), foam);
  const thin = smoothstep(SH.hug * 2, 0.07, thick);

  // From below: a clear window straight up, mirror-like beyond the critical angle.
  const tir = float(1).sub(smoothstep(U.windowCos[0], U.windowCos[1], cosV));
  const belowColor = uniforms.fogColor;
  const belowOpacity = lerp(float(U.windowOpacity), float(U.mirrorOpacity), tir);

  // Planar reflection of every object: the scene rendered from the camera mirrored in the still surface (TSL reflector), with the lookup
  // shifted by the wave normal so it ripples. Blended in by Fresnel, so it is strongest at grazing angles, like the calm pools of GMod.
  const RF = W.reflection;
  const mirror = reflector({ resolutionScale: RF.resolution, bounces: false });
  mirror.target.rotateX(-Math.PI / 2);
  reflectTarget.obj = mirror.target;
  mirror.uvNode = mirror.uvNode.add(vec2(nW.x, nW.z).mul(RF.distort));
  const reflColor = lerp(mirror.rgb, vec3(color(W.color.deep)), RF.darken);
  const fresR = saturate(fres.mul(RF.strength).add(RF.base));
  const outOfPass = float(1).sub(inRefl);

  // Refraction: the scene behind the surface (shared viewport copy) is sampled through the wave normal, tinted by the water body, and mixed in
  // where the water is see-through. Offset grows with thickness (none at the waterline) and shrinks with distance. Reflection, foam and glitter stay on top.
  const R = W.refract;
  const off = vec2(nW.x, nW.z).mul(R.strength).mul(min(thick, R.maxThick)).div(dist.mul(R.distFade).add(1));
  const seen = viewportSharedTexture(viewportSafeUV(screenUV.add(off))).rgb;
  const tinted = lerp(lerp(seen, bodyColor, body.mul(R.tint)), reflColor, fresR);
  const glintMask = saturate(max(glitter.x, max(glitter.y, glitter.z)).mul(2));
  // Held items (children of the camera) dip below the surface when aimed at the water: the surface near the camera is not drawn, so they never look submerged.
  const nearVis = smoothstep(W.viewmodel.near, W.viewmodel.far, dist);
  const refrMix = nearVis.mul(max(float(1).sub(body.mul(R.opaque)), fresR).mul(float(1).sub(foam)).mul(float(1).sub(glintMask)).mul(select(below, float(0), float(1)))).mul(outOfPass);

  const material = new THREE.MeshPhysicalNodeMaterial({ transparent: true, roughness: W.roughness, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  material.colorNode = vec4(select(below, belowColor, aboveColor), 1);
  material.opacityNode = select(below, belowOpacity, thin.mul(nearVis)).mul(outOfPass);
  material.backdropNode = tinted;
  material.backdropAlphaNode = refrMix;
  material.emissiveNode = select(below, belowColor.mul(U.tint), glitter);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(nF, 0)).xyz);
  // Vertex displacement: waves + ripples + swash lift the (subdivided) surface; local y is world y up to the map scale.
  // Where the ground is above the lifted surface the mesh hugs the ground (no sheet floats over land, none sinks under it), and the
  // Gerstner sideways shift is faded near the shore and the pool edge so the mesh is never stretched off the bank or away from the quad border.
  const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
  const uvV = wp.xz.sub(origin).mul(invSize);
  const dV = texture(depthTex, uvV).level(0).r;
  const fadeV = ampByDepth(dV);
  const wv = waveField(wp.xz);
  const liftV = wv.h.add(texture(simTex, uvV).level(0).r.mul(W.waves.splashGain)).mul(fadeV).add(swashAt(wp.xz, dV));
  // Hug only gentle banks: on steep ground (walls, ledges) the mesh would be dragged up into a slanted sheet, so it stays at the surface (hidden inside the wall).
  const eV = vec2(W.waves.meshCell * 1.5, 0).mul(invSize);
  const dAt = o => texture(depthTex, uvV.add(o)).level(0).r;
  const slopeV = max(dAt(eV).sub(dAt(eV.negate())).abs(), dAt(eV.yx).sub(dAt(eV.yx.negate())).abs()).div(W.waves.meshCell * 3);
  const hugV = select(slopeV.lessThan(SH.hugSlope), dV.negate().add(SH.hug), float(-100));
  const edgeV = min(min(wp.x.sub(origin.x), hiCorner.x.sub(wp.x)), min(wp.z.sub(origin.y), hiCorner.y.sub(wp.z)));
  const shiftV = smoothstep(W.waves.shoreFade, W.waves.shoreFade * 3, dV).mul(smoothstep(0, W.waves.edgeMargin, edgeV));
  material.positionNode = positionLocal.add(vec3(wv.sx.mul(shiftV), max(liftV, hugV), wv.sz.mul(shiftV)).mul(invScale));
  // Indoor pools must not mirror a sky they cannot see: the Fresnel reflection follows sky visibility.
  material.aoNode = SkyAmbient.node;
  material.specularIntensityNode = SkyAmbient.specular;
  return material;
}

/**
 * Held items (anything parented to the camera, e.g. a mod's gun) must draw AFTER the water: opaque meshes without depth write (or a low layer)
 * are painted first and the translucent surface then covers them, so a gun aimed at the pool looks submerged. Moving them to the end of the
 * transparent queue keeps them on top. Done once per mesh; re-scanned every HELD_SCAN seconds for items added later.
 */
const HELD_SCAN = 0.5;
const held = new WeakSet();
let heldClock = 0;
function liftHeld(camera, dt) {
  heldClock -= dt;
  if (heldClock > 0) return;
  heldClock = HELD_SCAN;
  camera.traverse(o => {
    if (o === camera || !o.isMesh || held.has(o)) return;
    held.add(o);
    o.renderOrder = Math.max(o.renderOrder, W.viewmodel.renderOrder);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !m.transparent) { m.transparent = true; m.needsUpdate = true; }
    }
  });
}

/** Bilinear signed depth at world (x, z): water depth, negative on the bank (how far it is above the surface); 0 outside the pool. */
function depthAt(x, z) {
  if (!S.ready) return 0;
  const fx = (x - S.info.minX) / S.cell - 0.5; const fz = (z - S.info.minZ) / S.cell - 0.5;
  if (fx < -0.5 || fz < -0.5 || fx > S.nx - 0.5 || fz > S.nz - 0.5) return 0;
  const i = Math.max(0, Math.min(S.nx - 2, Math.floor(fx))); const j = Math.max(0, Math.min(S.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)); const tz = Math.max(0, Math.min(1, fz - j));
  const d = S.depth; const k = j * S.nx + i;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + S.nx] * (1 - tx) + d[k + S.nx + 1] * tx) * tz;
}

/** Bilinear sample of a pool-sized grid at world (x, z) (cells clamp at the border). */
function gridAt(a, x, z) {
  const fx = (x - S.info.minX) / S.cell - 0.5; const fz = (z - S.info.minZ) / S.cell - 0.5;
  const i = Math.max(0, Math.min(S.nx - 2, Math.floor(fx))); const j = Math.max(0, Math.min(S.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)); const tz = Math.max(0, Math.min(1, fz - j));
  const k = j * S.nx + i;
  return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + S.nx] * (1 - tx) + a[k + S.nx + 1] * tx) * tz;
}

/** The visible surface height at (x, z): waves + ripples exactly as the shader lifts them, so bodies float on them. Null where there is no water. */
function surfaceAt(x, z) {
  if (!S.ready) return null;
  const d = depthAt(x, z);
  if (d <= W.minDepth) return null;
  let h = 0;
  for (const [dx, dz, k, speed, amp] of W.waves.layers) {
    const l = Math.hypot(dx, dz);
    h += Math.sin((x * dx + z * dz) / l * k + S.t * speed) * amp;
  }
  h += gridAt(S.sim.a, x, z) * W.waves.splashGain;
  return S.info.y + h * waveFade(d) + swashLift(x, z, d, S.t);
}

/**
 * What a body does to the water. `feet` = lowest point, speed = horizontal speed. Splashes when its feet or head cross the surface;
 * while moving through it, lays a wake along the path it just covered: a bow wave raised in front and a trough behind, scaled by
 * speed, which spreads into a V (the player outruns the ripples). Walking in the shallows pulses a ripple every stride.
 */
function disturb(key, x, z, feet, vy, speed, radius, height, dt) {
  const surf = surfaceAt(x, z);
  const st = S.prev.get(key);
  const next = { feet, x, z, dist: st?.dist ?? 0 };
  S.prev.set(key, next);
  if (surf === null) return;
  const R = W.ripple;
  const ox = S.info.minX; const oz = S.info.minZ;
  const isBelow = feet < surf;
  const headBelow = feet + height < surf;
  if (st) {
    if ((st.feet < surf) !== isBelow) {
      const amount = Math.max(R.splashMin, Math.min(R.splashMax, Math.max(-vy * R.splashScale, speed * R.splashSpeed))) * (isBelow ? 1 : R.exit);
      S.sim.splat(x - ox, z - oz, R.splashCells, amount, R.foam);
    }
    if (isBelow && (st.head ?? headBelow) !== headBelow && Math.abs(vy) > 2) S.sim.splat(x - ox, z - oz, R.splashCells, Math.min(R.splashMax, Math.abs(vy) * R.headSplash), R.foam * 0.6);
  }
  next.head = headBelow;
  if (!isBelow || !st || speed < 0.5) return;

  const mx = x - st.x; const mz = z - st.z;
  const moved = Math.hypot(mx, mz);
  if (moved < 1e-4 || moved > 8) return;
  const dx = mx / moved; const dz = mz / moved;
  const r = Math.max(R.wakeCells * S.cell, radius * 1.3);
  const cells = r / S.cell;
  // Wake while the body pierces the surface (not when fully under it).
  if (!headBelow) {
    const n = Math.max(1, Math.ceil(moved / S.cell));
    const push = Math.min(0.35, speed * R.wake * dt) / n;
    const foam = speed > R.wakeFoamSpeed ? R.foam * 0.6 : 0;
    for (let i = 1; i <= n; i++) {
      const px = st.x + mx * i / n; const pz = st.z + mz * i / n;
      S.sim.splat(px + dx * r - ox, pz + dz * r - oz, cells, -push * R.bow);
      S.sim.splat(px - dx * r * 0.6 - ox, pz - dz * r * 0.6 - oz, cells * 1.2, push, foam);
    }
  }
  // Footsteps in the shallows: one ripple per stride, bigger the faster you run.
  next.dist += moved;
  if (next.dist >= R.stride) {
    next.dist = 0;
    if (feet - (S.info.y - depthAt(x, z)) < R.stepDepth) S.sim.splat(x - ox, z - oz, R.stepCells, speed * R.step, 0);
  }
}

export const Water = {
  uniforms,

  /** Object3D that defines the reflection plane; the world adds it to the scene (null when the material was never built). */
  get reflectTarget() { return reflectTarget.obj; },

  /** Called by the water mesh before each draw: the surface hides itself in the reflection pass (any camera but the game's). */
  pass(cam) { inRefl.value = cam === S.camera ? 0 : 1; },

  /** The shared water material (built on first use). */
  material() { return (S.material ??= buildMaterial()); },

  /**
   * Bakes the depth field from the map's collision and starts the ripple sim. `info` = { minX, maxX, minZ, maxZ, y, scale } in world units (scale = map -> world)
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
        const cx = info.minX + (i + 0.5) * cell; const cz = info.minZ + (j + 0.5) * cell;
        let g = collision.groundHeight(cx, cz, 0.05, info.y + W.landReach, 0);
        // Overhangs (ledges, walkways, roofs) over the pool are not bank: when a standable surface lies at or below the water level under
        // a higher one, the lower one is the bed and the water continues beneath the overhang.
        if (g > info.y) {
          const fl = collision.floorsAt(cx, cz);
          let bed = -Infinity;
          for (const h of fl) if (h <= info.y) bed = h;
          if (bed > -Infinity) g = bed;
        }
        raw[j * nx + i] = g > info.y ? Math.max(-W.landReach, info.y - g) : Math.min(W.maxDepth, info.y - g);
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
    surfY.value = info.y;
    hiCorner.value.set(info.maxX, info.maxZ);
    if (reflectTarget.obj) { reflectTarget.obj.position.set(0, info.y, 0); reflectTarget.obj.updateMatrixWorld(true); }
    invScale.value = 1 / info.scale;
    Object.assign(S, { info, nx, nz, cell, depth });
    S.sim = new WaterSim({ nx, nz, cell, depth: depth.map(d => Math.max(0, d)), ...CONFIG.water.sim });
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
    S.t += dt;
    S.camera = camera;
    tU.value = S.t;
    liftHeld(camera, dt);
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
