import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, mix, renderOutput, uniform, color, vec3, vec4, float, screenUV, getViewPosition, normalize, dot, pow, max, min, exp, select, smoothstep, isBackgroundDepth } from 'three/tsl';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { CONFIG } from '../config.js';
import { Water } from './Water.js';

/**
 * Frame pipeline (TSL). Scene (+ normals) -> GTAO -> [god rays (raymarched through the whole-map shadow map of `rayLight`) + sun glow + lens flare +
 * bloom] -> tone mapping -> FXAA. With sun effects off the same pipeline runs without the sun passes, so the
 * antialiasing and tone mapping stay identical. Needs shadows enabled and a shadow-casting `rayLight` (Environment).
 * All numbers come from CONFIG.lighting.sunFx.
 */
export class PostFx {
  constructor(renderer, scene, camera, rayLight, sunDir) {
    const L = CONFIG.lighting;
    const F = L.sunFx;
    this.pipeline = new THREE.RenderPipeline(renderer);
    // Tone mapping is applied below (before FXAA, which expects display-referred colours).
    this.pipeline.outputColorTransform = false;
    const toScreen = node => fxaa(renderOutput(node, renderer.toneMapping, renderer.outputColorSpace));

    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: normalView }));
    const sceneColor = scenePass.getTextureNode('output');
    const sceneNormal = scenePass.getTextureNode('normal');
    const sceneDepth = scenePass.getTextureNode('depth');

    // Ambient occlusion (GTAO) darkens creases and contact points so surfaces stop looking flat.
    const A = L.ao;
    const aoPass = ao(sceneDepth, sceneNormal, camera);
    aoPass.resolutionScale = A.resolutionScale;
    aoPass.radius.value = A.radius * CONFIG.player.eyeHeight;
    aoPass.thickness.value = A.thickness;
    aoPass.samples.value = A.samples;
    const aoFactor = mix(1, aoPass.getTextureNode().sample(screenUV).r, A.strength);

    // God rays: depth-aware march through the shadow map, bilateral blur, edge-aware composite tinted by the sun.
    const G = F.godrays;
    const rays = godrays(sceneDepth, camera, rayLight);
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
    // Sky pixels are the ones the depth buffer never wrote (the sky does not write depth); isBackgroundDepth knows the
    // depth convention (reversed or not), so the mask stays exact at any distance.
    const skyMask = isBackgroundDepth(sceneDepth.sample(screenUV).r).select(float(1), float(0));
    // The sun is part of the sky, as in the save-ocean sky shader: a soft warm halo plus a crisp disc with a smooth edge. Both are
    // masked to sky pixels, so nothing glows over geometry. Not HDR-bright either, so bloom has nothing to smear.
    const halo = color(Gl.halo.color).mul(pow(cosAngle, float(Gl.halo.power)).mul(Gl.halo.intensity));
    const disc = color(Gl.disc.color).mul(smoothstep(Gl.disc.edge[0], Gl.disc.edge[1], cosAngle).mul(Gl.disc.intensity));
    const sun = halo.add(disc).mul(skyMask);
    const glow = vec4(sun, 0);
    const flareSource = vec4(disc.mul(skyMask), 1);
    // Camera under water (Water.js): per-channel absorption along the ray, up to the surface when the ray leaves the water, so deep
    // water turns blue and dark, red dies first, and looking up shows a bright window. Does nothing (under = 0) elsewhere.
    const WU = Water.uniforms;
    const camWorld = uniform(camera.matrixWorld);
    const rayY = camWorld.mul(vec4(rayView, 0)).y;
    const hitDist = getViewPosition(screenUV, sceneDepth.sample(screenUV).r, projInverse).length();
    const surfDist = select(rayY.greaterThan(0.001), WU.camDepth.div(rayY), float(1e4));
    const waterDist = min(select(skyMask.greaterThan(0.5), float(1e4), hitDist), surfDist);
    const underwater = rgb => {
      const t = exp(WU.absorb.mul(waterDist).negate());
      const fogged = rgb.mul(t).add(WU.fogColor.mul(vec3(1, 1, 1).sub(t)));
      return rgb.add(fogged.sub(rgb).mul(WU.under));
    };

    // The sun itself is not a toggleable effect: it stays when sun effects are off.
    this.plain = toScreen(vec4(underwater(sceneColor.rgb.mul(aoFactor).add(sun)), 1));

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

    const composite = withRays.mul(aoFactor).add(bloomPass).add(glow).add(flare.mul(Fl.intensity));
    this.full = toScreen(vec4(underwater(composite.rgb), 1));
    this.setSunEffects(true);
  }

  setSunEffects(on) {
    this.pipeline.outputNode = on ? this.full : this.plain;
    this.pipeline.needsUpdate = true;
  }

  render() { this.pipeline.render(); }
}
