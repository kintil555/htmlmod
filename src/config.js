/** Single source of truth for tunables. Change numbers here, never inline them elsewhere. */
export const CONFIG = {
  player: {
    walkSpeed: 14,
    sprintSpeed: 21,
    jumpSpeed: 14.5,
    gravity: 32,
    radius: 0.4,
    eyeHeight: 1.7,
    height: 1.9,
    stepHeight: 0.48,
    stepSmooth: 14,
    accel: 100,
    airControl: 0.45,
    lookSensitivity: 0.0022,
    fov: 75,
    sprintFov: 82,
    wallJump: { reach: 0.35, cooldown: 0.18, upSpeed: 15.5, kickSpeed: 19, minAway: 7, climbAway: 1.5 },
  },
  nextbot: {
    gravity: 30,
    jumpSpeed: 26,
    lookAheadTime: 0.9,
    lookAheadMin: 3,
    clearance: 0.6,
    jumpMargin: 1.2,
    jumpCooldown: 0.35,
    stuckTime: 0.5,
    stuckSpeedFrac: 0.25,
    avoidTime: 0.5,
    repathInterval: 0.1,
    catchBelow: 1.2,
    climbSpeed: 14,
    climbReach: 1.5,
    targetAboveGap: 1.0,
    bodyHeight: 1.9,
    stepHeight: 1,
    groundSnap: 0.6,
    stepSmooth: 30,
    /**
     * Navigation graph, baked automatically from the map's collision (any map, no hand-placed waypoints).
     * cell/radius: grid spacing and body radius used to test that a spot is open. headroom: min free height above a floor. edgeMargin: floor must extend this far around a spot, so paths keep clear of ledges.
     * walkRise: biggest height change walked between neighbour cells (equals nextbot.stepHeight, the bot's own stride). jumpCells/dropCells: how far a jump up / drop down may reach.
     * minAirWindow: seconds a jump must stay above its ledge. directCost: path cost below which the bot just runs at the target.
     * progressTime/progressMin/banTime: if a bot on a planned path moves less than progressMin in progressTime seconds, its next graph node is banned for banTime (takes another route). carrotHops/carrotCos: path smoothing (skip ahead along straight walk edges). nodeSearch: ring (cells) searched to snap a position to the graph.
     */
    nav: {
      cell: 1.5,
      radius: 1.1,
      headroom: 1,
      edgeMargin: 1.2,
      walkRise: 1,
      jumpCells: 3,
      dropCells: 3,
      maxDrop: 40,
      jumpPenalty: 4,
      dropPenalty: 1,
      minAirWindow: 0.25,
      flowInterval: 0.25,
      directCost: 4,
      carrotHops: 3,
      carrotCos: 0.7,
      nodeSearch: 2,
      yieldMs: 12,
      progressTime: 1,
      progressMin: 1.5,
      banTime: 3,
    },
  },
  /** Which map is loaded (id from content/maps.js). The map is scaled so its player eye height matches player.eyeHeight. */
  world: {
    map: 'gm_construct',
    floorDepth: 4,
    shadowPad: 2,
    aimMargin: 3,
    voidMargin: 2,
  },
  /** Loading bar slices (fractions of the whole bar): assets end, map end, navigation bake end; shaders take the rest. */
  loading: { assets: 0.08, map: 0.6, nav: 0.75, uploadBatch: 4 },
  /** Like Source's light_environment, with Valve's own values (HL2 sky list, d2_coast: sun RGB 243 238 224 at -45 degrees, skylight RGB 172 196 204 at about 1/8 of the sun): a nearly white sun with dynamic shadows plus a flat, cool skylight (hemisphere) as ambient; GTAO adds the contact darkness. Sun, sky, ambient light, fog, tone mapping. Elevation/azimuth in degrees; azimuth 0 = +Z, 90 = +X. */
  lighting: {
    toneMapping: 'neutral',
    exposure: 0.88,
    sun: { elevation: 45, azimuth: 215, intensity: 3.4, color: 0xf3eee0 },
    sky: { turbidity: 3, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.82, scale: 450000, clouds: { coverage: 0.5, density: 0.55, elevation: 0.5 } },
    environmentIntensity: 0.1,
    hemisphere: { sky: 0xacc4cc, ground: 0x8c7e68, intensity: 0.66 },
    /**
     * Ambient visibility (world/SkyAmbient.js). The sky fill and environment light are scaled by how much sky a surface sees,
     * so spots under roofs, balconies and indoors get exactly `minimum` of the ambient (bounce light) instead of the open-sky amount, right up to the walls.
     * Distances are in eye heights: `reach` probe radius, `lift` push out along the normal, `soft` height blend, `bias` slack.
     * `taps` probes per pixel, `resolution` height-field cells along the map's longer side, `dilate` cells roofs are grown by (stops leaks at their edges).
     */
    skyAmbient: { resolution: 2048, dilate: 2, taps: 20, reach: 2.5, lift: 0.25, soft: 0.6, bias: 0.1, minimum: 0.3 },
    /**
     * Sun shadows are cascaded shadow maps (three/addons/csm): `cascades` maps of `mapSize`, splitting the view out to `maxFar`
     * world units (nearest cascade is the sharpest). `lightMargin` must exceed the map's height. Bias is a fraction of the
     * shadow depth range (about lightMargin + 2 * maxFar), normalBias is in world units. `fade` blends between cascades.
     * `rays` is the separate whole-map shadow map the god rays march through.
     */
    shadow: { cascades: 4, mapSize: 3072, maxFar: 200, lightMargin: 120, bias: -0.00002, normalBias: 0.04, radius: 2, fade: true, rays: { mapSize: 2048, bias: -0.0004, normalBias: 0.12, radius: 2 } },
    fog: { color: 0xc5d2d8, density: 0.0016 },
    /** Fallback surface for map materials that match nothing in `surfaces`. */
    material: { roughness: 0.9, metalness: 0 },
    /**
     * Surface classes, picked by the first `match` hitting the baked material name. roughness/metalness shape the
     * highlight; `specular` (0..1) is the Fresnel reflectance of non-metals (how much sky shows at grazing angles; fades to 0 under roofs and indoors, see SkyAmbient.specular);
     * `env` scales the sky reflection for that class.
     */
    surfaces: [
      { id: 'metal', match: /metal|duct|ladder|bell|rooftop|citadel/i, roughness: 0.32, metalness: 0.6, specular: 1, env: 2.5 },
      { id: 'plastic', match: /plastic|florescent|switch|doll/i, roughness: 0.3, metalness: 0, specular: 1, env: 2 },
      { id: 'wood', match: /furnituretable|wood/i, roughness: 0.55, metalness: 0, specular: 0.6, env: 1.5 },
      { id: 'fabric', match: /couch/i, roughness: 0.95, metalness: 0, specular: 0.25, env: 1 },
      { id: 'brick', match: /brick/i, roughness: 0.9, metalness: 0, specular: 0.35, env: 1 },
      { id: 'plaster', match: /plaster/i, roughness: 0.8, metalness: 0, specular: 0.5, env: 1.2 },
      { id: 'floor', match: /floor|stair|ground|dev/i, roughness: 0.62, metalness: 0, specular: 0.7, env: 1.8 },
      { id: 'concrete', match: /concrete|wall|building_template|color_room/i, roughness: 0.82, metalness: 0, specular: 0.5, env: 1.3 },
      { id: 'grass', match: /grass/i, roughness: 1, metalness: 0, specular: 0.15, env: 0.6 },
    ],
    /** Glass reflects `base` of the scene head-on and fully at grazing angles (Fresnel), over a dark glass tint. */
    mirror: { color: 0xdbe6e6, resolution: 0.75, multisample: 4, offset: 0.01, base: 0.5, power: 4, dark: 0x1a2a30 },
    /**
     * Post effects around the sun (src/world/PostFx.js). Glow shapes are cos(angle to sun)^power: a higher power
     * is a tighter blob. `haze` is how much of the halo (never the disc) shows over geometry (0 = only on open sky).
     */
    sunFx: {
      godrays: { steps: 60, density: 0.6, maxDensity: 0.45, distanceAttenuation: 2, resolutionScale: 0.5, intensity: 0.6, edgeRadius: 2, edgeStrength: 2 },
      bloom: { strength: 0.05, radius: 0.4, threshold: 4 },
      /** Sun in the sky (sky pixels only), after the save-ocean sky shader. Halo: color * cos^power * intensity. Disc: smoothstep(edge[0], edge[1], cos) * intensity, so edge is the cosine of the angle (outer, inner). */
      glow: { halo: { color: 0xffe6b3, power: 8, intensity: 0.35 }, disc: { color: 0xfff7e0, edge: [0.9975, 0.9992], intensity: 2 } },
      flare: { intensity: 0.18, threshold: 0.5, ghostSamples: 4, ghostSpacing: 0.3, ghostAttenuation: 25, downSample: 4, tint: 0xfff0d8 },
    },
    /** Ambient occlusion (GTAO). `radius` is in eye heights; `strength` 0 = off, 1 = full. Always on, not part of the sun effects toggle. */
    ao: { radius: 0.6, thickness: 1, samples: 16, resolutionScale: 0.5, strength: 0.8 },
  },
  /**
   * Water (src/world/Water.js, WaterSim.js). Distances are world units, times seconds.
   * grid: ripple cells along the pool's longer side. maxDepth/landReach/minDepth: depth bake (a cell with ground above the surface is land;
   * minDepth is the least depth that still counts as water for swimming and ripples).
   * absorb: how fast the body turns opaque with depth; colorDepth: shallow->deep colour blend; minOpacity/maxOpacity: clarity at 0 / full depth.
   * waves.layers: [dirX, dirZ, wavenumber, speed, amplitude] sine waves that raise/lower the surface (vertex displacement) and tilt the normal.
   * splashGain: how much the simulated ripples/splashes lift the surface; shoreFade: depth over which waves grow from nothing at the shore; meshCell: water mesh grid size.
   * sim: speed = ripple travel speed; shoreDamp/deepDamp = per-step energy kept in the shallows / open water; limit = max |height|.
   * ripple: wake = push per second per unit of speed; splash* = entry splash from the vertical / horizontal speed; foam = foam laid by a splash.
   * foam: shoreWidth = foam band at the waterline; crest/crestGain = foam on steep ripple crests. glitter: sun reflection (core = the sun, path = sparkle road).
   * under: view from below. absorb = per-channel (r,g,b) loss per unit of water between you and what you see; windowCos = Snell window edge.
   * swim: at = fraction of the body under water that counts as swimming; buoyancy x gravity at full submersion; drag = per-second damping;
   * slow = wading speed loss; up/down = vertical swim accel; exitJump = hop out at the surface; pitchSpeed = look-direction swimming.
   */
  water: {
    grid: 192, maxDepth: 40, landReach: 4, minDepth: 0.15,
    color: { shallow: 0x58c4c0, deep: 0x0a3d5c, foam: 0xf4fbff },
    absorb: 0.11, colorDepth: 0.22, minOpacity: 0.16, maxOpacity: 0.93, roughness: 0.1,
    waves: {
      rippleGain: 1.2, splashGain: 2.5, shoreFade: 1.2, meshCell: 0.75, detail: 0.035, detailScale: 1.9, fadeNear: 40, fadeFar: 160, farKeep: 0.4,
      layers: [
        [1, 0.2, 0.31, 0.9, 0.225], [-0.6, 1, 0.47, 1.1, 0.175], [0.3, -1, 0.83, 1.5, 0.11],
        [-1, -0.5, 1.3, 1.9, 0.075], [0.8, 0.7, 2.1, 2.4, 0.045], [-0.2, 1, 3.4, 3, 0.025],
      ],
    },
    sim: { speed: 11, step: 1 / 60, shoreDamp: 0.86, deepDamp: 0.9935, shoreFull: 0.8, edge: 8, limit: 1.2, foamDecay: 0.55, crest: 0.05, crestGain: 4, idle: 0.0003 },
    ripple: { wake: 0.2, splashScale: 0.05, splashSpeed: 0.02, splashMin: 0.12, splashMax: 1.2, exit: 0.5, wakeCells: 1.6, splashCells: 2.6, wakeFoamSpeed: 10, foam: 0.9 },
    foam: { crestStart: 0.45, crestEnd: 0.8, shoreWidth: 0.9, shoreSpeed: 0.8, noiseScale: 1.1, noiseSpeed: 0.25, fineScale: 3.4, opacity: 0.92 },
    glitter: { core: 9, corePower: 1600, path: 2.2, pathPower: 90, freq: 14, speed: 1.4, threshold: [0.6, 0.88], opacityGain: 0.6 },
    under: { absorb: [0.2, 0.07, 0.04], shallow: 0x2aa3b8, deep: 0x03182a, depthFade: 0.045, blendRate: 14, windowCos: [0.6, 0.72], windowOpacity: 0.08, mirrorOpacity: 0.9, tint: 0.7 },
    swim: { at: 0.55, buoyancy: 1.3, dragY: 2.6, dragXZ: 1.4, slow: 0.3, accel: 0.7, up: 46, upMax: 9, down: 46, downMax: 11, exitJump: 11, pitchSpeed: 0.9 },
  },
  limits: { maxNextbots: 30, maxProps: 80 },
  catchState: { respawnDelay: 1.6, invulnerable: 2.0, pushRadius: 14 },
  /** Camera ragdoll on catch: the head is thrown away from the bot, tumbles, bounces and settles on its side. */
  ragdoll: {
    headRadius: 0.25,
    knockback: 9,
    pop: 6,
    gravity: 32,
    restitution: 0.38,
    groundFriction: 6,
    airDrag: 0.4,
    spinRoll: 9,
    spinPitch: 5,
    spinYaw: 4,
    bounceSpinKeep: 0.6,
    groundSpinDamp: 3.5,
    restSpeed: 1.2,
    settleRate: 5,
  },
  spawnMenu: { stickyMs: 250, closeGraceMs: 800 },
};
