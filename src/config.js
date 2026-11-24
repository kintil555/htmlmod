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
  /** Sun, sky, ambient light, fog, tone mapping. Elevation/azimuth in degrees; azimuth 0 = +Z, 90 = +X. */
  lighting: {
    toneMapping: 'neutral',
    exposure: 0.8,
    sun: { elevation: 42, azimuth: 215, intensity: 3.2, color: 0xfff1dc },
    sky: { turbidity: 3, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.82, scale: 450000, clouds: { coverage: 0.5, density: 0.55, elevation: 0.5 } },
    environmentIntensity: 0.35,
    hemisphere: { sky: 0xa9c8ff, ground: 0x7d705f, intensity: 0.3 },
    /** Sun shadow window follows the player: `extent` = half its width in world units (smaller = sharper, but shorter range). */
    shadow: { mapSize: 4096, extent: 36, bias: -0.00015, normalBias: 0.04, radius: 9 },
    fog: { color: 0xc3d6ea, density: 0.0016 },
    /** Fallback surface for map materials that match nothing in `surfaces`. */
    material: { roughness: 0.9, metalness: 0 },
    /**
     * minAmbient 1 = mask off (no second, blocky sky shadow); lower it (e.g. 0.2) to darken covered places again.
     * Ambient light that reaches covered places (rooms, tunnels, under overhangs). `minAmbient` is what stays
     * under a roof (0 = pitch black), `offset`/`margin`/`softness` are world units for the roof test, `resolution` the
     * roof-height grid cells across the longer side of the map.
     */
    skylight: { minAmbient: 1, offset: 0.5, margin: 0.15, softness: 0.6, resolution: 1024 },
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
     * is a tighter blob. `haze` is how much halo leaks over geometry (0 = only on open sky).
     */
    sunFx: {
      godrays: { steps: 60, density: 0.6, maxDensity: 0.45, distanceAttenuation: 2, resolutionScale: 0.5, intensity: 0.6, edgeRadius: 2, edgeStrength: 2 },
      bloom: { strength: 0.05, radius: 0.4, threshold: 4 },
      glow: { disc: { power: 3000, intensity: 6 }, halo: { power: 60, intensity: 0.2 }, haze: 0.08 },
      flare: { intensity: 0.18, threshold: 0.5, ghostSamples: 4, ghostSpacing: 0.3, ghostAttenuation: 25, downSample: 4, tint: 0xffe2b8 },
    },
    /** Ambient occlusion (GTAO). `radius` is in eye heights; `strength` 0 = off, 1 = full. Always on, not part of the sun effects toggle. */
    ao: { radius: 0.35, thickness: 1, samples: 16, resolutionScale: 0.5, strength: 0.6 },
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
