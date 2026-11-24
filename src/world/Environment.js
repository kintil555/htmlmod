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
 * The sun shadow map is redrawn every frame around the player (`followShadow`), so moving props and bots cast shadows too.
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
    const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    scene.add(sun, sun.target);

    // The shadow map is a small window (2 * extent wide) that follows the player: far sharper than one map fitted to
    // the whole level. Depth range covers the tallest geometry between the sun and the window.
    const S = L.shadow;
    this._shadowDist = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
    const half = Math.max(S.extent, bounds.maxY - bounds.minY);
    const cam = sun.shadow.camera;
    cam.left = -S.extent; cam.right = S.extent; cam.bottom = -S.extent; cam.top = S.extent;
    cam.near = this._shadowDist - half; cam.far = this._shadowDist + half;
    cam.updateProjectionMatrix();

    sun.castShadow = true;
    sun.shadow.mapSize.set(S.mapSize, S.mapSize);
    sun.shadow.bias = S.bias;
    sun.shadow.normalBias = S.normalBias;
    sun.shadow.radius = S.radius;
    this._sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    this._sunUp = new THREE.Vector3().crossVectors(sunDir, this._sunRight);
    this._center = new THREE.Vector3();
    this.sun = sun;
    this.followShadow(new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2));
    return sun;
  }

  /**
   * Centers the shadow window on `point`. The centre is snapped to whole shadow texels in light space so shadow
   * edges do not crawl while the player moves. Call every frame before rendering.
   */
  followShadow(point) {
    const S = CONFIG.lighting.shadow;
    const texel = 2 * S.extent / S.mapSize;
    const x = Math.round(point.dot(this._sunRight) / texel) * texel;
    const y = Math.round(point.dot(this._sunUp) / texel) * texel;
    this._center.set(0, 0, 0)
      .addScaledVector(this._sunRight, x)
      .addScaledVector(this._sunUp, y)
      .addScaledVector(this.sunDir, point.dot(this.sunDir));
    this.sun.target.position.copy(this._center);
    this.sun.position.copy(this._center).addScaledVector(this.sunDir, this._shadowDist);
  }
}
