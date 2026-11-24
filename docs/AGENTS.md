# Rules for AI/contributors (read before editing)

One game, one style. Everything is a library. **Extend, never duplicate.**

## Hard rules
1. No build step, no new dependencies. Three.js is vendored in `vendor/` (r187). Import it as `import * as THREE from 'three'`; the renderer, node materials and anything TSL come from `three/webgpu` and `three/tsl` (same core, one instance).
2. All UI is built from `src/ui/ui.js` components (`Button`, `Panel`, `Tabs`, `Card`, `SettingControl`, `toast`, `ScreenManager`). Need something new? Add a component there plus CSS in `src/ui/theme.css`.
3. No raw colors, fonts, or pixel spacing outside the tokens at the top of `theme.css` (`--c-*`, `--s*`, `--font`).
4. No user-facing text in code. Put it in `src/content/strings.js`.
5. No magic numbers for gameplay. Put them in `src/config.js`.
6. Content is data in registries. Do not edit engine code to add content.
7. Do not touch unrelated files. Do not leave TODOs or placeholders.
8. Run `node test/logic.test.mjs` and `node test/nav.test.mjs` after touching `steering.js`, `Collision.js`, `NavGraph.js` or `colliders.js`; `node test/sky.test.mjs` after touching `HeightField.js`; `node test/mirror.test.mjs` after touching the vendored reflector patch.

## Recipes
**Add a nextbot:** put `assets/nextbots/<id>.png` (transparent PNG), add one line to `src/content/nextbots.js`. It appears in the Q menu automatically.

**Add a prop:** one line in `src/content/props.js` (`size:[w,h,d]`, `color`). Axis-aligned boxes only.

**Add a spawn-menu tab:** `SpawnTabRegistry.register({id,label,order,items,spawn})` in `src/content/spawntabs.js`; add a `game.spawnX()` method in `Game.js`.

**Add a setting:** `Settings.define({...})` in `src/content/settings.js` (see `core/Settings.js`). The Settings screen renders it automatically. Read with `Settings.get(id)`.

**Add an entity type:** extend `entities/Entity.js`, implement `update(dt, ctx)`, set `type`, cache shared geometry/materials at module level. Add via `world.add()`.

**Add a screen:** build it in `ui/screens.js` from `ui.js` components, register it in `Game.boot()`.

**Add a map:** run `python3 tools/bake_map.py <glTF dir> assets/maps/<id>` (needs numpy + Pillow; build-time only), then add one entry to `src/content/maps.js` (`eyeHeight`, `spawn`). Set `CONFIG.world.map` to load it. The map is scaled at load so its player eye height equals `CONFIG.player.eyeHeight`. Keep the author's license file next to the map and credit it in `STR.help`.

**Nextbot navigation:** automatic. `world/NavGraph.js` bakes a multi-level graph from the map's collision at load (walk, jump up, drop down edges; tunnels and roofs included), so a new map needs nothing extra. One shared flow field from the player gives every bot its next waypoint; bots jump ledges up to the jump apex. Tunables: `CONFIG.nextbot.nav`, `stepHeight`, `jumpSpeed`.

**Mirrors:** any flat pane whose material name starts with `MIRROR` in `tools/bake_map.py` (default: `glassreflectiveglass`, `mirror`) is baked with `mirror: true` and rebuilt by `world/Mirror.js` as real planar TSL `reflector()` nodes (one per plane, plus a back-side twin). No per-pane code. Tunables: `CONFIG.lighting.mirror`.

**Lighting/sky:** all numbers live in `CONFIG.lighting`; code is `world/Environment.js` (SkyMesh sky, sun, soft shadow window). The sun uses cascaded shadow maps (`CSMShadowNode`, `CONFIG.lighting.shadow`), redrawn every frame around the camera, so props and bots cast shadows and distant geometry is shadowed too. God rays read a separate whole-map shadow map from an invisible second light (`env.rayLight`).

**Sky ambient + depth:** `world/SkyAmbient.js` bakes a top-down height field of the map (`world/HeightField.js`, pure data) and every map/prop material samples it as `aoNode`, so sky fill + environment light fade under roofs and indoors (`CONFIG.lighting.skyAmbient`, never touches the sun). The renderer uses a reversed float depth buffer (`Game.boot()`, better precision, no distant z-fighting). Post passes must use `isBackgroundDepth` / `perspectiveDepthToViewZ`, never raw `depth >= 1` compares. Vendored three.js is patched in one place: `ReflectorBaseNode.updateBefore` (in `vendor/three.tsl.js` and `vendor/three.webgpu.nodes.js`) has a reversed-depth branch for the oblique mirror clip plane; without it glass/mirror panes render garbage and surfaces flicker (`test/mirror.test.mjs` checks the maths). Re-apply it when upgrading three.js. Anything that pins geometry to the far plane with `z = w` (SkyMesh) must pin to `z = 0` when `renderer.reversedDepthBuffer` is true (see `Environment.js`). The sun (soft halo + crisp disc, `sunFx.glow`) is drawn in `PostFx` on sky pixels only (hard-masked by the sky mask), and SkyMesh's own sun disc stays off (`Environment.js`): it was HDR-bright and bloom/flare smeared it over geometry.

**Surfaces / Fresnel:** map materials get roughness, metalness, Fresnel reflectance (`specular`) and sky-reflection strength from the first `CONFIG.lighting.surfaces` entry whose `match` hits the baked material name (`surfaceFor()` in `world/MapLoader.js`). Water and glass use a view-angle Fresnel (`world/Fresnel.js`): water turns opaque and reflective at grazing angles, glass blends from dark to fully mirrored. Add a class by adding one entry.

**Sun effects + AO:** `world/PostFx.js` (TSL pipeline: GTAO ambient occlusion `CONFIG.lighting.ao`, god rays through the sun shadow map, sun glow, lens flare, bloom, tone mapping, FXAA). Tunables: `CONFIG.lighting.sunFx`. Players toggle it in Settings (`sunEffects`). The renderer is `WebGPURenderer` and falls back to its WebGL2 backend by itself; GLSL `ShaderMaterial` does not work with it, use node materials.

**Water:** a map material baked with `water: true` becomes the pool (`world/Water.js`, tunables `CONFIG.water`). At load the pool's depth is baked from the map's collision (0 = land), which drives clarity/colour, shoreline foam, swimming and the under-water check. `world/WaterSim.js` (pure data, `node test/water.test.mjs`) is the ripple + foam simulation; the player and nextbots disturb it when they wade, swim or dive in (`Water.update`, called by `World.update`). The material shows wave + ripple normals, Fresnel sky reflection, foam and sun glitter (from below: a Snell window). Under water the camera gets absorption fog from a post effect in `PostFx.js` (driven by `Water.uniforms`). Swimming lives in `Player._swim` (`CONFIG.water.swim`; Space up, C dive, W/S along the look direction). Shoreline: `world/Shore.js` (pure data, tested in `test/water.test.mjs`) is a swell whose phase runs with the baked signed depth, so crests travel up the slope (fast uprush onto the bank, slow backwash that draws the waterline below the still level); `Water.js` has the node mirror and the CPU surface uses the same functions. Open-water waves fade out over the bank (`bankFade`), the mesh hugs the ground where there is no water, thickness is mesh height minus baked ground (the waterline is where mesh meets ground), and the Gerstner sideways shift fades near the shore and the pool edge. Tunables: `CONFIG.water.shore`, `waves.bankFade/edgeMargin`. A map without a water material costs nothing.

**Mods (ZIP loader):** `src/mods/` (`Zip.js` reader/writer, `Manifest.js`, `Modules.js` import rewriting, `ModStore.js` IndexedDB, `ModAPI.js` the `api` mods receive, `HtmlMod.js`, `Mods.js` host, `Sdk.js` downloads). Public contract: `sdk/README.md` + `sdk/htmlmod.d.ts` (keep them in sync with `ModAPI.js`, bump `CONFIG.mods.apiVersion` on breaking changes). Engine events for mods are emitted as `events.emit('game:<name>')`. Anything a mod registers must be undone through `own()` in `ModAPI.js`. Run `node test/mods.test.mjs` after touching `src/mods/`. Files shipped by the SDK button are listed in `CONFIG.mods.sdkFiles`.

**Add a new content file:** import it in `src/content/index.js`.

## Layout
- `core/` engine utilities: Events, Registry, Settings, Assets, Input
- `world/` World, Collision (boxes with optional `bottom`), MapLoader, Environment (sky/sun/shadows), PostFx (sun effects), colliders decoder, procedural textures
- `tools/` build-time scripts (map baker), not shipped
- `entities/` Entity, Player, Nextbot, Prop, steering (pure math)
- `content/` data: nextbots, props, spawn tabs, settings, strings
- `ui/` components, screens, spawn menu, HUD, theme.css
- `Game.js` state machine and tools; `main.js` entry
