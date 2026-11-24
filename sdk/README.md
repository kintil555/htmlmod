# Html Sandbox — Mod SDK (API 1)

A mod is a **ZIP file** with HTML and/or JavaScript. Install it in the game: **Mods → Install Mod (.zip)**.
Mods are stored in the browser (IndexedDB), can be switched on/off and removed, and load before the game boots.
Mods run with full page access: only install mods you trust. Start without mods with `?nomods` in the address.

## Quick start
1. Download **Template** (or copy `examples/hello-js`).
2. Edit `main.js`, zip the *files* (`mod.json` at the zip root; a single wrapping folder is also accepted).
3. Install the zip in Mods. Installing a mod with the same `id` updates it.

## ZIP layout
    mod.json      optional manifest
    main.js       ES module, JS entry
    index.html    HTML entry (optional, can be combined with main.js)
    ...           any other files: images, audio, JSON, more .js files

### mod.json
| field | meaning |
|---|---|
| `id` | `a-z 0-9 - _`, 2-40 chars. Default: zip file name |
| `name`, `version`, `author`, `description` | shown in Mods |
| `api` | API version the mod needs (current: `1`) |
| `main` | JS entry. Default: `main.js` or `index.js` |
| `html` | HTML entry. Default: `index.html` when no JS entry exists |
| `css` | array of CSS files applied to the HTML entry |

Limits: zip ≤ 50 MB, ≤ 2000 files, ≤ 200 MB unpacked. No encryption/ZIP64.

## JS mods
`main.js` is an ES module. Export a default function (sync or async); it receives `api`.

    export default async function (api) { ... }
    export function unload() { ... }          // optional extra cleanup

- Relative imports between your files work (`import { x } from './lib/x.js'`). Circular imports do not.
- `import * as THREE from 'three'` works (also `three/webgpu`, `three/tsl`, `three/addons/...`). `api.THREE` is the same instance.
- Files of the zip are not reachable through `new URL(..., import.meta.url)`: use `api.assets`.
- The default function has 10 s to finish. A mod that throws is marked Failed; the game still starts.

## HTML mods
`index.html` is mounted in a shadow root over the game (`<style>`, `<body>`, relative `src`/`href`/`url()` of zip files).
Scripts get `api`, `root` (the shadow root) and `THREE` in scope; they may use `await`.
`<script src="x.js">` loads a zip file as a JS mod module (default export gets `(api, root)`).
Use `root.getElementById` / `root.querySelector`, never `document`. Use `addEventListener` or `.onclick`
(inline `onclick="..."` attributes cannot see `api`). The layer ignores the mouse; set `pointer-events: auto` on interactive parts
and call `api.cursor.free()` while the mouse is needed.

## Everything is undone on unload
Disabling/removing a mod removes its registrations, events, DOM, entities, spawned bots/props of its content,
config changes (`api.config.set`), settings definitions, textures and blob URLs. Things you change directly
(`api.world`, `THREE` objects you modified, globals) you must restore in `api.onUnload(fn)`.
A mod that throws more than 20 times in callbacks is unloaded automatically.

## API
### Info
`api.id`, `api.manifest`, `api.apiVersion`, `api.THREE`, `api.CONFIG` (live tunables, see `src/config.js`), `api.log(...)`.

### State (null until `ready`)
`api.game`, `api.world`, `api.scene`, `api.player`, `api.camera`, `api.renderer`, `api.input`, `api.hud`, `api.ready` (Promise).

### Events — `api.on(name, fn)` returns an off function
| event | payload |
|---|---|
| `ready` | game (fires once the game booted; immediately if it already did) |
| `start` / `pause` / `resume` / `quit` | — |
| `update` | `dt` seconds, every frame while playing and not paused |
| `caught` | the nextbot that caught the player |
| `entity:add` / `entity:remove` | entity |
| `keydown` / `keyup` | `{ code, repeat }` (fires in menus too: check `api.game.state === 'playing'`) |

Between mods: `api.bus.on(name, fn)`, `api.bus.emit(name, payload)`.
`api.onUnload(fn)` runs when the mod unloads.

### Content (ids become `"<modId>:<id>"`)
- `await api.nextbots.register({ id, name, texture, height, speed, turnRate, accel, decel })` — `texture` is a zip path (transparent PNG) or URL. Missing numbers use defaults.
- `api.props.register({ id, name, size: [w, h, d], color })` — axis-aligned boxes.
- `api.spawnTabs.register({ id, label, order, items: () => [{ id, name, image?|swatch? }], spawn(itemId, point, game) })` — Q-menu tab.
- `api.maps.register(def)` — see `src/content/maps.js`; `url` must be a normal URL folder (not a zip file).
- `api.menu.addButton({ label, where: 'main'|'pause'|'both', order, onClick })`.

### Spawning and entities
`api.spawn.nextbot(id, point?)`, `api.spawn.prop(id, point?)`, `api.spawn.aimPoint()` (point is a `THREE.Vector3`; default: crosshair).
`api.entities.add(entity)` / `remove(entity)`. Base classes: `api.classes.Entity | Nextbot | Prop`.
Custom entity: subclass `Entity`, set `object3d` (a `THREE.Group`), implement `update(dt, ctx)`, `onAdded()`, `onRemoved()`.

### Assets (files in your zip)
`api.assets.has(path)`, `list(prefix?)`, `url(path)` (blob URL), `text`, `json`, `bytes`, `texture(path)` (THREE.Texture).

### Settings, storage, config
- `api.settings.define({ id, label, type: 'toggle'|'slider'|'select', default, min, max, step, options, category })`, `get(id)`, `set(id, v)`, `onChange(fn)`. Shown in Settings.
- `api.storage.get(key, fallback)`, `set(key, value)`, `remove(key)` — JSON, private to the mod, deleted when the mod is removed.
- `api.config.get('player.walkSpeed')`, `api.config.set('player.walkSpeed', 20)` — restored on unload.

### UI
`api.ui.el`, `Button`, `Panel`, `Tabs`, `Card`, `SettingControl`, `toast` (the game's own components).
`api.ui.mount(node)` adds to the UI layer; `api.ui.mountHud(node)` adds to the in-game HUD. CSS variables `--c-*`, `--s*`, `--font` are available.
`const release = api.cursor.free()` frees the mouse without opening the pause menu; call `release()` to lock again.

## Tips
- Press **Q** (spawn menu) and **R** (remove) are built in; pick other keys.
- Test fast: reinstall the zip (same `id` updates it). Open DevTools: logs are prefixed `[mod:<id>]`.
- Keep `three` usage on the game's instance (`api.THREE` or the `three` import). Do not bundle your own copy.
