import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CONFIG } from '../config.js';

const TONE = {
  none: THREE.NoToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};

/**
 * Daylight: analytic sky dome, sun with one static shadow map fitted to the map, image-based ambient light
 * baked from the sky, hemisphere fill, fog and tone mapping. All numbers come from CONFIG.lighting.
 * Shadows are re-rendered only when `markShadowsDirty()` is called (Game does that when props change).
 * Needs an initialised WebGPURenderer (`await renderer.init()`).
 */
export class Environment {
  constructor(renderer, scene, bounds) {
    const L = CONFIG.lighting;
    renderer.toneMapping = TONE[L.toneMapping] ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = L.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const sunDir = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - L.sun.elevation), THREE.MathUtils.degToRad(L.sun.azimuth));
    this.sunDir = sunDir;

    const sky = new SkyMesh();
    sky.scale.setScalar(L.sky.scale);
    sky.turbidity.value = L.sky.turbidity;
    sky.rayleigh.value = L.sky.rayleigh;
    sky.mieCoefficient.value = L.sky.mieCoefficient;
    sky.mieDirectionalG.value = L.sky.mieDirectionalG;
    sky.cloudCoverage.value = L.sky.clouds.coverage;
    sky.cloudDensity.value = L.sky.clouds.density;
    sky.cloudElevation.value = L.sky.clouds.elevation;
    sky.sunPosition.value.copy(sunDir);

    // Ambient light from the sky itself (no sun disc in the environment map).
    sky.showSunDisc.value = 0;
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(envScene);
    scene.environment = env.texture;
    scene.environmentIntensity = L.environmentIntensity;
    pmrem.dispose();
    sky.showSunDisc.value = 1;
    scene.add(sky);
    this.sky = sky;

    scene.add(new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity));
    scene.fog = new THREE.FogExp2(L.fog.color, L.fog.density);

    this.sun = this._makeSun(scene, bounds, sunDir);
  }

  _makeSun(scene, bounds, sunDir) {
    const L = CONFIG.lighting;
    const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);
    const radius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2;
    sun.position.copy(center).addScaledVector(sunDir, radius * 2);
    sun.target.position.copy(center);
    scene.add(sun, sun.target);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);

    // Fit the orthographic shadow frustum around the whole map, in light space.
    const cam = sun.shadow.camera;
    cam.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) for (const z of [bounds.minZ, bounds.maxZ]) {
      box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse));
    }
    const pad = CONFIG.world.shadowPad;
    cam.left = box.min.x - pad; cam.right = box.max.x + pad;
    cam.bottom = box.min.y - pad; cam.top = box.max.y + pad;
    cam.near = Math.max(0.1, -box.max.z - pad); cam.far = -box.min.z + pad;
    cam.updateProjectionMatrix();

    sun.castShadow = true;
    sun.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize);
    sun.shadow.bias = L.shadow.bias;
    sun.shadow.normalBias = L.shadow.normalBias;
    sun.shadow.radius = L.shadow.radius;
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    return sun;
  }

  /** The static sun shadow map is redrawn on the next frame (props added/removed). */
  markShadowsDirty() { this.sun.shadow.needsUpdate = true; }
}
