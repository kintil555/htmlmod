import * as THREE from 'three/webgpu';
import { pass, renderOutput, uniform, color, vec4, float, screenUV, getViewPosition, normalize, dot, pow, max, step } from 'three/tsl';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { CONFIG } from '../config.js';

/**
 * Frame pipeline (TSL). Scene -> [god rays (raymarched through the sun's shadow map) + sun glow + lens flare +
 * bloom] -> tone mapping -> FXAA. With sun effects off the same pipeline runs without the sun passes, so the
 * antialiasing and tone mapping stay identical. Needs shadows enabled and a shadow-casting sun.
 * All numbers come from CONFIG.lighting.sunFx.
 */
export class PostFx {
  constructor(renderer, scene, camera, sun, sunDir) {
    const L = CONFIG.lighting;
    const F = L.sunFx;
    this.pipeline = new THREE.RenderPipeline(renderer);
    // Tone mapping is applied below (before FXAA, which expects display-referred colours).
    this.pipeline.outputColorTransform = false;
    const toScreen = node => fxaa(renderOutput(node, renderer.toneMapping, renderer.outputColorSpace));

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const sceneDepth = scenePass.getTextureNode('depth');
    this.plain = toScreen(sceneColor);

    // God rays: depth-aware march through the shadow map, bilateral blur, edge-aware composite tinted by the sun.
    const G = F.godrays;
    const rays = godrays(sceneDepth, camera, sun);
    rays.raymarchSteps.value = G.steps;
    rays.density.value = G.density;
    rays.maxDensity.value = G.maxDensity;
    rays.distanceAttenuation.value = G.distanceAttenuation;
    rays.resolutionScale = G.resolutionScale;
    const raysBlurred = bilateralBlur(rays.getTextureNode());
    const withRays = depthAwareBlend(sceneColor, raysBlurred.getTextureNode(), sceneDepth, camera, {
      blendColor: new THREE.Color(L.sun.color).multiplyScalar(G.intensity),
      edgeRadius: G.edgeRadius,
      edgeStrength: G.edgeStrength,
    });

    // Sun shape from the view ray vs the sun direction. These uniforms hold the camera's own matrices because
    // the built-in camera nodes would see the fullscreen quad's camera inside a post pass.
    const projInverse = uniform(camera.projectionMatrixInverse);
    const viewMatrix = uniform(camera.matrixWorldInverse);
    const sunWorld = uniform(sunDir.clone().normalize());
    const sunView = normalize(viewMatrix.mul(vec4(sunWorld, 0)).xyz);
    const rayView = normalize(getViewPosition(screenUV, float(0.5), projInverse));
    const cosAngle = max(dot(rayView, sunView), 0);
    const Gl = F.glow;
    const shape = pow(cosAngle, float(Gl.disc.power)).mul(Gl.disc.intensity)
      .add(pow(cosAngle, float(Gl.halo.power)).mul(Gl.halo.intensity));
    const sunColor = color(L.sun.color);
    // Sky pixels are the ones the depth buffer never wrote (the sky does not write depth).
    const skyMask = step(0.99999, sceneDepth.sample(screenUV).r);
    const glow = vec4(sunColor.mul(shape).mul(skyMask.mul(1 - Gl.haze).add(Gl.haze)), 0);
    const flareSource = vec4(sunColor.mul(shape).mul(skyMask), 1);

    const Fl = F.flare;
    const flare = lensflare(flareSource, {
      ghostTint: color(Fl.tint),
      threshold: Fl.threshold,
      ghostSamples: Fl.ghostSamples,
      ghostSpacing: Fl.ghostSpacing,
      ghostAttenuationFactor: Fl.ghostAttenuation,
      downSampleRatio: Fl.downSample,
    });
    const B = F.bloom;
    const bloomPass = bloom(sceneColor, B.strength, B.radius, B.threshold);

    const composite = withRays.add(bloomPass).add(glow).add(flare.mul(Fl.intensity));
    this.full = toScreen(vec4(composite.rgb, 1));
    this.setSunEffects(true);
  }

  setSunEffects(on) {
    this.pipeline.outputNode = on ? this.full : this.plain;
    this.pipeline.needsUpdate = true;
  }

  render() { this.pipeline.render(); }
}
