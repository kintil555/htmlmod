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
   * shoreKeep: share of the wave height kept right at the waterline; bankFade: bank height (above the surface) over which waves die out, so the bank is never lifted by open-water waves.
   * shore (world/Shore.js): a swell that travels up the slope. Its phase runs with the baked signed depth (phasePerDepth cycles per unit; land depth is negative =
   * bank height above the surface), so crests move shoreward: a fast uprush (rise = share of the cycle spent rising) that runs up the bank (reach = bank height where it dies)
   * and a slow backwash that draws the waterline below the still level (draw = trough depth as a share of height). height: crest above still level; period: seconds per wave;
   * shallowStart/shallowEnd: depth where the swell fades into open water; wobble: [kx, kz, cycles] sines that vary the phase along the shore; hug: how far the mesh sits above the
   * ground where there is no water and the bank is gentler than hugSlope (rise/run; walls and ledges are left alone). Water thickness = mesh height - baked ground, so the waterline is exactly where the mesh meets the ground.
   * splashGain: how much the simulated ripples/splashes lift the surface; shoreFade: depth over which waves grow from nothing at the shore; meshCell: water mesh grid size.
   * sim: speed = ripple travel speed; shoreDamp/deepDamp = per-step energy kept in the shallows / open water; limit = max |height|.
   * waves.choppy: Gerstner sharpening of crests. ripple: wake = push per second per unit of speed, laid along the path as a bow wave (bow = share raised in front) with a trough behind (V wake);
   * stride/step/stepCells/stepDepth = a ripple pulse per stride walked in shallows (step = push per unit of speed); headSplash = head breaking the surface; splash* = entry splash from the vertical / horizontal speed; foam = foam laid by a splash.
   * foam: shoreWidth = foam band at the waterline; crest/crestGain = foam on steep ripple crests. glitter: sun reflection (core = the sun, path = sparkle road).
   * under: view from below. absorb = per-channel (r,g,b) loss per unit of water between you and what you see; windowCos = Snell window edge.
   * swim: at = fraction of the body under water that counts as swimming; buoyancy x gravity at full submersion; drag = per-second damping;
   * slow = wading speed loss; up/down = vertical swim accel; exitJump = hop out at the surface; pitchSpeed = look-direction swimming.
   */
  water: {
    grid: 192, maxDepth: 40, landReach: 4, minDepth: 0.15,
    /** Thickest ledge/roof (top minus underside) that still counts as an overhang over the pool; anything thicker is bank or terrain. */
    overhangMax: 1.5,
    color: { shallow: 0x6aa9a6, deep: 0x1a5470, foam: 0xf4fbff },
    absorb: 0.09, colorDepth: 0.2, minOpacity: 0.12, maxOpacity: 0.86, roughness: 0.02,
    waves: {
      rippleGain: 0.8, splashGain: 1.2, choppy: 0, shoreFade: 1.2, shoreKeep: 0.25, bankFade: 0.3, edgeMargin: 1.5, meshCell: 0.75, detail: 0.01, detailScale: 1.1, fadeNear: 40, fadeFar: 160, farKeep: 0.7,
      layers: [
        [1, 0.2, 0.22, 0.35, 0.02], [-0.6, 1, 0.38, 0.45, 0.012], [0.3, -1, 0.65, 0.6, 0.006],
        [-1, -0.5, 1.1, 0.8, 0.003],
      ],
    },
    /** Viewmodel: the water surface fades out between `near` and `far` distance from the camera, so a held gun poked into the water stays dry; renderOrder = draw order given to meshes parented to the camera so they draw after (on top of) the water. */
    viewmodel: { near: 0.9, far: 1.4, renderOrder: 1000 },
    /** Planar reflection of all objects (a second scene render from the mirrored camera): resolution = share of screen size; strength/base = Fresnel gain and floor of the mirror mix; distort = wave-normal shift of the lookup; darken = pull toward the deep colour. */
    reflection: { resolution: 0.5, strength: 1.1, base: 0.06, distort: 0.35, darken: 0.18 },
    /** Refraction: strength = screen-uv shift per unit of wave slope and thickness (capped at maxThick); distFade shrinks it with distance; tint = body colour blended into the refracted view; opaque = how much depth hides the bottom. */
    refract: { strength: 6, maxThick: 1.5, distFade: 0.02, tint: 0.85, opaque: 0.75 },
    shore: {
      height: 0.05, period: 9, rise: 0.4, draw: 0.3, phasePerDepth: 0.35, reach: 0.9, shallowStart: 0.8, shallowEnd: 3, hug: 0.006, hugSlope: 0.45,
      wobble: [[0.37, 0.23, 0.3], [0.19, -0.41, 0.2]],
    },
    sim: { speed: 9, step: 1 / 60, shoreDamp: 0.8, deepDamp: 0.985, shoreFull: 0.8, edge: 8, limit: 0.25, foamDecay: 0.55, crest: 0.05, crestGain: 4, idle: 0.0003 },
    ripple: { wake: 0.05, bow: 0.5, stride: 1.5, step: 0.03, stepCells: 2, stepDepth: 0.35, headSplash: 0.05, splashScale: 0.05, splashSpeed: 0.02, splashMin: 0.12, splashMax: 0.3, exit: 0.5, wakeCells: 1.6, splashCells: 2.6, wakeFoamSpeed: 14, foam: 0.3 },
    foam: { crestStart: 0.5, crestEnd: 0.9, shoreWidth: 0.25, frontWidth: 0.3, noiseScale: 1.1, noiseSpeed: 0.25, fineScale: 3.4, opacity: 0.45 },
    glitter: { core: 5, corePower: 1600, path: 0.5, pathPower: 120, freq: 14, speed: 1.4, threshold: [0.6, 0.88], opacityGain: 0.6 },
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
  /**
   * Multiplayer (src/net). WebRTC data channels between the host and each guest; the Cloudflare Worker + Durable Object in worker/ only
   * pairs them up by invite code (signalling). signalUrl: that Worker; override once with ?signal=wss://host (remembered in localStorage).
   * protocol: bump on any wire change. maxPlayers: host + guests. sendRate: state packets per second. playerSmooth/botSmooth: follow rate of remote players / bots toward the latest packet; teleportDist: jumps farther than this snap.
   * retargetSec/retargetBias: the host points the nextbots at the nearest living player, re-picked this often; the current target keeps the pick unless another is closer than bias x its distance.
   * modHashBytes: head + tail of each mod ZIP hashed to prove both sides run the same mod build.
   * avatar: glTF skinned player model. height = world units head to toe. rig = bone names. gait: stride = distance per full step cycle; angles in radians.
   */
  net: {
    signalUrl: 'wss://htmlmod-signal.secret5.workers.dev',
    signalParam: 'signal',
    signalStorage: 'htmlmod.signal',
    joinParam: 'join',
    protocol: 1,
    /** Cloudflare Turnstile site key ("I'm not a robot" before host / join). Empty = check off. The secret goes on the worker (worker/README.md). */
    turnstileSiteKey: '0x4AAAAAAGTyEJTVwaMdXJj1',
    maxPlayers: 8,
    /** Abuse limits, enforced by the host per guest. Rates are per second; a peer is dropped after maxStrikes refused packets. */
    maxPending: 4,
    maxStrikes: 200,
    ctlRate: 15, ctlBurst: 30,
    stateRate: 40, stateBurst: 60,
    spawnRate: 3, spawnBurst: 6,
    clearCooldownSec: 3,
    spawnReach: 150,
    boundsMargin: 20,
    maxGuestMsgChars: 16384,
    maxStateMsgChars: 512,
    maxHostMsgChars: 262144,
    codeLength: 6,
    codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
    connectTimeoutMs: 20000,
    disconnectGraceMs: 5000,
    signalPingMs: 25000,
    sendRate: 20,
    maxBuffered: 65536,
    playerSmooth: 18,
    botSmooth: 18,
    teleportDist: 8,
    nameMax: 20,
    retargetSec: 1,
    retargetBias: 0.8,
    modHashBytes: 8 * 1024 * 1024,
    nameTag: { width: 2.4, height: 0.36, above: 0.35, canvasW: 512, canvasH: 80, font: 52, outline: 8 },
    avatar: {
      url: 'assets/players/male07/scene.gltf',
      height: 1.9,
      rig: {
        footL: 'foot.l_059', toesL: 'toes_01.l_060',
        thighL: 'thigh_stretch.l_056', thighR: 'thigh_stretch.r_062',
        kneeL: 'leg_stretch.l_058', kneeR: 'leg_stretch.r_064',
        armL: 'arm_stretch.l_033', armR: 'arm_stretch.r_08',
        elbowL: 'forearm_stretch.l_035', elbowR: 'forearm_stretch.r_010',
        handL: 'hand.l_037', handR: 'hand.r_012',
        root: 'root.x_01', footR: 'foot.r_065', spine: 'spine_01.x_02', chest: 'spine_03.x_04', neck: 'neck.x_05', head: 'head.x_06',
      },
      armDrop: { out: 0.1, forward: 0.04 },
      elbowDrop: { out: 0.06, forward: -0.3 },
      /**
       * gait: stride = distance per full step cycle (maxHz caps the cycle rate); swing / knee / arm / elbow = peak angles (rad);
       * kneeRest = knee flex at ground contact; foot = share of the leg angle the ankle cancels; hipTwist / spineTwist = pelvis and shoulder twist;
       * lean = forward lean at full speed; elbowSwing = extra elbow bend on the forward arm swing; breath / breathHz = idle chest motion;
       * blend / airBlend = how fast speed and the air pose fade in.
       */
      gait: { stride: 3.8, maxHz: 6, swing: 0.75, knee: 1.15, kneeRest: 0.15, foot: 0.8, arm: 0.6, elbow: 0.25, elbowSwing: 0.5, hipTwist: 0.16, spineTwist: 0.12, lean: 0.12, speedFull: 21, blend: 10, airBlend: 12, breath: 0.015, breathHz: 0.25 },
      /** Share of the look pitch taken by each bone. Spread over three joints so no single one bends far enough to pinch the mesh. */
      look: { chest: 0.2, neck: 0.3, head: 0.3 },
      /** Jump pose per leg [left, right]: thigh forward and knee tucked (rad); armOut = arms spread sideways; foot = toes down; lean = torso. */
      air: { thigh: [0.9, 0.75], knee: [1.25, 1.05], armOut: 1.15, elbow: 0.25, foot: 0.3, lean: 0.05 },
      fall: { angle: 1.45, rate: 7 },
    },
  },
  /**
   * Touch controls (ui/TouchControls.js). Shown on phones and tablets (pointer: coarse); ?touch=1 / ?touch=0 forces them on / off.
   * stick: radius = px, deadzone = share of the radius before a direction counts, sprintAt = share of the radius that also sprints.
   * lookScale: camera turn per px dragged, relative to a mouse pixel.
   */
  touch: {
    param: 'touch',
    stick: { radius: 64, deadzone: 0.35, sprintAt: 0.85 },
    lookScale: 1.6,
  },
  /**
   * Graphics quality (core/Quality.js). `quality` setting: auto = `autoTouch` on phones / tablets, `autoDesktop` elsewhere.
   * A preset is merged into CONFIG.lighting (shadow, ao, skyAmbient, mirror) and CONFIG.water.reflection before anything is built, so it
   * applies on the next page load. pixelRatio = cap on the canvas resolution (CSS px multiplier), anisotropy = texture filtering cap.
   * Phone GPUs are fill-rate bound, so the biggest wins are the pixel ratio, the extra scene renders (water / mirrors), shadow maps and GTAO.
   * adaptive: the render scale only ever goes down (never back up, so it cannot oscillate): every `windowSec` seconds below `targetFps`
   * it drops by `step`, to at most `minScale`; `warmupSec` skips shader-compile hitches after start.
   */
  quality: {
    autoTouch: 'low',
    autoDesktop: 'high',
    presets: {
      low: {
        pixelRatio: 1, anisotropy: 2, sunEffects: false,
        shadow: { cascades: 2, mapSize: 1024, maxFar: 80, radius: 1, rays: { mapSize: 256 } },
        ao: { enabled: false },
        skyAmbient: { resolution: 1024, taps: 10 },
        mirror: { resolution: 0.35, multisample: 0 },
        waterReflection: { resolution: 0.25 },
      },
      medium: {
        pixelRatio: 1.5, anisotropy: 4, sunEffects: false,
        shadow: { cascades: 3, mapSize: 2048, maxFar: 140, rays: { mapSize: 1024 } },
        ao: { samples: 8, resolutionScale: 0.35 },
        skyAmbient: { resolution: 1536, taps: 14 },
        mirror: { resolution: 0.5, multisample: 2 },
        waterReflection: { resolution: 0.4 },
      },
      high: { pixelRatio: 2, anisotropy: 8, sunEffects: true },
    },
    adaptive: { minScale: 0.5, step: 0.1, targetFps: 40, windowSec: 2, warmupSec: 3 },
  },
  /** Mod loader (src/mods). Mods are ZIP files with HTML/JS, stored in IndexedDB. API contract: sdk/README.md. */
  mods: {
    /** Current mod API. Bump on breaking changes: mods built for an older API still load but are flagged as outdated. */
    apiVersion: 1,
    /** Oldest mod API the loader still runs. Older mods are refused with an error. */
    minApiVersion: 1,
    dbName: 'htmlmod.mods',
    storagePrefix: 'htmlmod.mod.',
    skipParam: 'nomods',
    idPattern: '^[a-z0-9][a-z0-9_-]{1,39}$',
    maxZipBytes: 2 * 1024 * 1024 * 1024,
    maxEntries: 20000,
    maxUnpackedBytes: 4 * 1024 * 1024 * 1024,
    /** Per start-up phase; big mods spend most of it unpacking. */
    loadTimeoutMs: 60000,
    maxRuntimeErrors: 20,
    /** Fields a mod may omit from nextbot / prop definitions. */
    defaults: { nextbot: { height: 3.2, speed: 14, turnRate: 4, accel: 28, decel: 28 }, prop: { color: '#9a9fa5' } },
    /** Order value for mod content so it lists after built-in content. */
    orderBase: 1000,
    entryCandidates: ['main.js', 'index.js', 'index.html'],
    /** Files shipped by the "Download SDK" button: paths are relative to sdk/ and keep their path inside the zip. */
    sdkZipName: 'htmlmod-sdk.zip',
    sdkFiles: ['README.md', 'htmlmod.d.ts', 'examples/hello-js/mod.json', 'examples/hello-js/main.js', 'examples/hello-js/bot.png', 'examples/hello-html/mod.json', 'examples/hello-html/index.html'],
    /** "Download template" ships this example as a ready-to-edit mod (paths relative to the example folder). */
    templateDir: 'examples/hello-js/',
    templateZipName: 'hello-mod.zip',
  },
};
