# Rules for AI/contributors (read before editing)

One game, one style. Everything is a library. **Extend, never duplicate.**

## Hard rules
1. No build step, no new dependencies. Three.js is vendored in `vendor/` (r187). Import it as `import * as THREE from 'three'`.
2. All UI is built from `src/ui/ui.js` components (`Button`, `Panel`, `Tabs`, `Card`, `SettingControl`, `toast`, `ScreenManager`). Need something new? Add a component there plus CSS in `src/ui/theme.css`.
3. No raw colors, fonts, or pixel spacing outside the tokens at the top of `theme.css` (`--c-*`, `--s*`, `--font`).
4. No user-facing text in code. Put it in `src/content/strings.js`.
5. No magic numbers for gameplay. Put them in `src/config.js`.
6. Content is data in registries. Do not edit engine code to add content.
7. Do not touch unrelated files. Do not leave TODOs or placeholders.
8. Run `node test/logic.test.mjs` after touching `steering.js`, `Collision.js` or `colliders.js`.

## Recipes
**Add a nextbot:** put `assets/nextbots/<id>.png` (transparent PNG), add one line to `src/content/nextbots.js`. It appears in the Q menu automatically.

**Add a prop:** one line in `src/content/props.js` (`size:[w,h,d]`, `color`). Axis-aligned boxes only.

**Add a spawn-menu tab:** `SpawnTabRegistry.register({id,label,order,items,spawn})` in `src/content/spawntabs.js`; add a `game.spawnX()` method in `Game.js`.

**Add a setting:** `Settings.define({...})` in `src/content/settings.js` (see `core/Settings.js`). The Settings screen renders it automatically. Read with `Settings.get(id)`.

**Add an entity type:** extend `entities/Entity.js`, implement `update(dt, ctx)`, set `type`, cache shared geometry/materials at module level. Add via `world.add()`.

**Add a screen:** build it in `ui/screens.js` from `ui.js` components, register it in `Game.boot()`.

**Add a map:** run `python3 tools/bake_map.py <glTF dir> assets/maps/<id>` (needs numpy + Pillow; build-time only), then add one entry to `src/content/maps.js` (`eyeHeight`, `spawn`). Set `CONFIG.world.map` to load it. The map is scaled at load so its player eye height equals `CONFIG.player.eyeHeight`. Keep the author's license file next to the map and credit it in `STR.help`.

**Mirrors:** any flat pane whose material name starts with `MIRROR` in `tools/bake_map.py` (default: `glassreflectiveglass`, `mirror`) is baked with `mirror: true` and rebuilt by `world/Mirror.js` as real planar `Reflector`s (one per plane, plus a back-side twin). No per-pane code. Tunables: `CONFIG.lighting.mirror`.

**Lighting/sky:** all numbers live in `CONFIG.lighting`; code is `world/Environment.js`. Shadows are static; they re-render only when a prop is added or removed (`entity.castsShadow = true`).

**Add a new content file:** import it in `src/content/index.js`.

## Layout
- `core/` engine utilities: Events, Registry, Settings, Assets, Input
- `world/` World, Collision (boxes with optional `bottom`), MapLoader, Environment (sky/sun), colliders decoder, procedural textures
- `tools/` build-time scripts (map baker), not shipped
- `entities/` Entity, Player, Nextbot, Prop, steering (pure math)
- `content/` data: nextbots, props, spawn tabs, settings, strings
- `ui/` components, screens, spawn menu, HUD, theme.css
- `Game.js` state machine and tools; `main.js` entry
