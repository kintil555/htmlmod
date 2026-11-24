import * as THREE from 'three/webgpu';
import { texture, uniform, positionWorld, normalWorld, vec3, float, mix, smoothstep, min, dot, cos, sin, interleavedGradientNoise, screenCoordinate, Fn } from 'three/tsl';
import { CONFIG } from '../config.js';
import { rasterizeHeights, HEIGHT_EMPTY } from './HeightField.js';

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Sky visibility for ambient light. Sun shadows cannot darken the sky/bounce fill, so a room under a roof was lit like open
 * ground. SkyAmbient bakes a top-down height field of the map once (HeightField.js) and every map material samples it as
 * `aoNode`: a ring of probes around the surface point (pushed out along the normal, never into the surface) checks whether
 * anything is above it. Open sky = full ambient; roofs, balconies, tunnels and interiors = ambient fades to
 * `CONFIG.lighting.skyAmbient.minimum`. It scales indirect light only (sky fill + environment), never the sun.
 * All distances in CONFIG.lighting.skyAmbient are in eye heights. Until bake() runs everything counts as open sky.
 * Smoothness: heights are stored as half floats and sampled with bilinear filtering (no grid steps), and the probe ring is
 * rotated per pixel by interleaved gradient noise so the few probes dither into a continuous gradient instead of bands.
 */
const K = CONFIG.lighting.skyAmbient;
const unit = CONFIG.player.eyeHeight;

const heightTex = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(HEIGHT_EMPTY)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
heightTex.minFilter = THREE.LinearFilter;
heightTex.magFilter = THREE.LinearFilter;
heightTex.generateMipmaps = false;
heightTex.needsUpdate = true;

const origin = uniform(new THREE.Vector2());
const invSize = uniform(new THREE.Vector2(1, 1));
const heights = texture(heightTex);

const openness = Fn(() => {
  const n = normalWorld.normalize();
  const base = positionWorld.add(n.mul(K.lift * unit));
  const spin = interleavedGradientNoise(screenCoordinate).mul(Math.PI * 2);
  const cs = cos(spin); const sn = sin(spin);
  let open = float(0);
  for (let i = 0; i < K.taps; i++) {
    const a = i * GOLDEN_ANGLE;
    const r = Math.sqrt((i + 0.5) / K.taps) * K.reach * unit;
    const ca = Math.cos(a) * r; const sa = Math.sin(a) * r;
    const d = vec3(cs.mul(ca).sub(sn.mul(sa)), 0, sn.mul(ca).add(cs.mul(sa)));
    // Drop the part of the offset that points into the surface, so a wall never probes through itself.
    const q = base.add(d.sub(n.mul(min(dot(d, n), 0))));
    const h = heights.sample(q.xz.sub(origin).mul(invSize)).r;
    open = open.add(smoothstep(0, K.soft * unit, q.y.sub(h).add(K.bias * unit)));
  }
  return mix(K.minimum, 1, open.div(K.taps));
})();

export const SkyAmbient = {
  /** Float node, 1 = open sky, `minimum` = fully covered. Assign to a node material's `aoNode`. */
  node: openness,

  /** Rasterizes the map's triangles (collectTriangles() output) into the height field. Call before the first render. */
  bake(chunks, bounds) {
    const field = rasterizeHeights(chunks, bounds, K.resolution);
    const half = new Uint16Array(field.data.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(field.data[i]);
    heightTex.image = { data: half, width: field.width, height: field.height };
    heightTex.needsUpdate = true;
    origin.value.set(field.minX, field.minZ);
    invSize.value.set(1 / (field.width * field.cell), 1 / (field.height * field.cell));
  },
};
