import * as THREE from 'three/webgpu';
import { texture, uniform, positionWorld, normalWorld, vec3, float, mix, smoothstep, min, dot, cos, sin, interleavedGradientNoise, screenCoordinate, Fn } from 'three/tsl';
import { CONFIG } from '../config.js';
import { rasterizeHeights, dilateHeights, HEIGHT_EMPTY } from './HeightField.js';

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
 * Enclosure: a point whose own column is covered (a room, tunnel, balcony) ignores the ring completely, because the height
 * field cannot tell a wall from open air and the ring would otherwise count ground outside the room as sky.
 * Two outputs from one probe pass: `node` (ambient, floors at `minimum`) and `specular` (sky reflection, floors at 0).
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

/** Height field value (highest surface) in the column of `p`. */
const columnTop = (p) => heights.sample(p.xz.sub(origin).mul(invSize)).r;
/** Sky seen from a probe: grows from 0 to 1 as `p` rises above the highest surface in its column. */
const clearance = (p) => smoothstep(0, K.soft * unit, p.y.sub(columnTop(p)).add(K.bias * unit));

/** Value of `skyView` on flat open ground: a surface lifted only `lift` off the ground reads below full clearance. */
const OPEN = (t => t * t * (3 - 2 * t))(Math.min(1, (K.lift + K.bias) / K.soft));

/** Share of the sky a point sees: 0 under any roof or ceiling, `OPEN` on open ground. Computed once per pixel and shared. */
const skyView = Fn(() => {
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
    open = open.add(clearance(q));
  }
  // The height field has no walls, so near a wall of a covered room the ring reaches past it onto open ground and reads as sky:
  // a bright band along every interior edge. The ring only counts where the point's own column is open (its top is more than
  // `bias` below the point, which every surface seen from above satisfies thanks to `lift`), so anything under a roof or
  // ceiling gets exactly `minimum` and sky fill never leaks in through walls. Open ground is untouched.
  const covered = smoothstep(-K.bias * unit, 0, columnTop(base).sub(base.y));
  return open.div(K.taps).mul(float(1).sub(covered));
})().toVar('skyView');

export const SkyAmbient = {
  /** Float node, 1 = open sky, `minimum` = fully covered. Assign to a node material's `aoNode`. */
  node: mix(K.minimum, 1, skyView),

  /**
   * Float node, 1 = open sky, 0 = no sky at all. Scales the Fresnel/specular reflectance (`specularIntensityNode`): the sky
   * reflection is the one thing an enclosed room cannot show, so unlike `node` it drops to exactly 0 under a roof.
   * `aoNode` cannot do this: the indirect specular occlusion in three.js collapses to the same `minimum` for rough surfaces.
   */
  specular: smoothstep(0, OPEN, skyView),

  /** Rasterizes the map's triangles (collectTriangles() output) into the height field. Call before the first render. */
  bake(chunks, bounds) {
    const field = rasterizeHeights(chunks, bounds, K.resolution);
    // Grow roof edges, then give uncovered cells the map's lowest height so bilinear sampling blends towards open ground
    // instead of towards a huge negative number (which read as open sky right up to a roof's rim).
    const solid = dilateHeights(field, K.dilate);
    const half = new Uint16Array(solid.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(solid[i] <= HEIGHT_EMPTY ? bounds.minY : solid[i]);
    heightTex.image = { data: half, width: field.width, height: field.height };
    heightTex.needsUpdate = true;
    origin.value.set(field.minX, field.minZ);
    invSize.value.set(1 / (field.width * field.cell), 1 / (field.height * field.cell));
  },
};
