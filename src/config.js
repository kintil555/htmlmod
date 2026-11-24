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
     * so spots under roofs, balconies and indoors get `minimum` of the ambient (bounce light) instead of the open-sky amount.
     * Distances are in eye heights: `reach` probe radius, `lift` push out along the normal, `soft` height blend, `bias` slack.
     * `taps` probes per pixel, `resolution` height-field cells along the map's longer side.
     */
    skyAmbient: { resolution: 2048, taps: 12, reach: 2.5, lift: 0.25, soft: 0.6, bias: 0.1, minimum: 0.3 },
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
     * highlight; `specular` (0..1) is the Fresnel reflectance of non-metals (how much sky shows at grazing angles);
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
      glow: { disc: { power: 3000, intensity: 6 }, halo: { power: 60, intensity: 0.2 }, haze: 0.03 },
      flare: { intensity: 0.18, threshold: 0.5, ghostSamples: 4, ghostSpacing: 0.3, ghostAttenuation: 25, downSample: 4, tint: 0xfff0d8 },
    },
    /** Ambient occlusion (GTAO). `radius` is in eye heights; `strength` 0 = off, 1 = full. Always on, not part of the sun effects toggle. */
    ao: { radius: 0.6, thickness: 1, samples: 16, resolutionScale: 0.5, strength: 0.8 },
    /** Water is clearest looking down and turns opaque, mirroring the sky, at grazing angles (Fresnel). */
    water: { color: 0x3d7d9c, opacity: 0.6, roughness: 0.05, power: 3 },
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
