import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { CONFIG } from '../config.js';

const TONE = {
  none: THREE.NoToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};

/**
 * Daylight: analytic sky dome, sun with cascaded shadow maps, image-based ambient light
 * baked from the sky, hemisphere fill, fog and tone mapping. All numbers come from CONFIG.lighting.
 * The cascades are redrawn every frame around the camera, so moving props and bots cast shadows too.
 * Needs an initialised WebGPURenderer (`await renderer.init()`).
 */
export class Environment {
  constructor(renderer, scene, bounds) {
    const L = CONFIG.lighting;
    renderer.toneMapping = TONE[L.toneMapping] ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = L.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

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
    const S = L.shadow;
    const size = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
    const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);

    // The sun: cascaded shadow maps. Cascade 0 is a tight window right in front of the camera (sharp contact shadows),
    // the later ones cover further and further out to `maxFar`, all re-fitted to the camera every frame.
    const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    sun.position.copy(center).addScaledVector(sunDir, size);
    sun.target.position.copy(center);
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(S.mapSize, S.mapSize);
    sun.shadow.bias = S.bias;
    sun.shadow.normalBias = S.normalBias;
    sun.shadow.radius = S.radius;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = S.lightMargin + 2 * S.maxFar;
    const csm = new CSMShadowNode(sun, { cascades: S.cascades, maxFar: S.maxFar, mode: 'practical', lightMargin: S.lightMargin });
    csm.fade = S.fade;
    sun.shadow.shadowNode = csm;
    this.sun = sun;

    // God rays march through one plain shadow map (they cannot read cascades): an invisible second sun (intensity 0)
    // whose static window covers the whole map at low resolution.
    const R = S.rays;
    const ray = new THREE.DirectionalLight(0xffffff, 0);
    const extent = size / 2;
    ray.position.copy(center).addScaledVector(sunDir, size);
    ray.target.position.copy(center);
    scene.add(ray, ray.target);
    ray.castShadow = true;
    ray.shadow.mapSize.set(R.mapSize, R.mapSize);
    ray.shadow.bias = R.bias;
    ray.shadow.normalBias = R.normalBias;
    ray.shadow.radius = R.radius;
    const cam = ray.shadow.camera;
    cam.left = -extent; cam.right = extent; cam.bottom = -extent; cam.top = extent;
    cam.near = size - extent; cam.far = size + extent;
    cam.updateProjectionMatrix();
    this.rayLight = ray;
    return sun;
  }
}
