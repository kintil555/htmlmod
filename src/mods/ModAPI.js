import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { events } from '../core/Events.js';
import { Settings } from '../core/Settings.js';
import { Assets } from '../core/Assets.js';
import { NextbotRegistry, PropRegistry, SpawnTabRegistry, MapRegistry, MenuButtonRegistry } from '../core/registries.js';
import { Entity } from '../entities/Entity.js';
import { Nextbot, forgetNextbotMaterial } from '../entities/Nextbot.js';
import { Prop } from '../entities/Prop.js';
import { el, Button, Panel, Tabs, Card, SettingControl, toast } from '../ui/ui.js';
import { normalizePath } from './Zip.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  json: 'application/json', txt: 'text/plain', css: 'text/css', js: 'text/javascript', html: 'text/html',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

/**
 * Builds the `api` object handed to one mod. Everything a mod registers through it is tracked in mod.disposers
 * and undone when the mod unloads. The full contract is documented in sdk/README.md and sdk/htmlmod.d.ts.
 */
export function createModAPI(host, mod) {
  const modId = mod.id;
  /** Registers an undo function. If the mod is already unloaded (late async registration) it runs at once. */
  const own = fn => { if (mod.dead) fn(); else mod.disposers.push(fn); return fn; };
  const needGame = () => {
    if (!host.game) throw new Error(`[${modId}] game is not ready yet: use api.on('ready', ...)`);
    return host.game;
  };
  const guard = fn => {
    try { return fn(); } catch (err) { host.runtimeError(mod, err); return undefined; }
  };
  const log = (...a) => console.log(`[mod:${modId}]`, ...a);

  /* ---------- assets (files inside the zip) ---------- */
  const urlCache = new Map();
  const pathOf = p => {
    const n = normalizePath(p);
    if (!n || !mod.zip.has(n)) throw new Error(`[${modId}] no such file in mod: ${p}`);
    return n;
  };
  const assets = {
    has: p => { const n = normalizePath(p); return !!n && mod.zip.has(n); },
    list: (prefix = '') => mod.zip.names().filter(n => n.startsWith(prefix)),
    bytes: p => mod.zip.bytes(pathOf(p)),
    text: p => mod.zip.text(pathOf(p)),
    json: async p => JSON.parse(await mod.zip.text(pathOf(p))),
    /** blob: URL for a file of the zip (images, audio, fonts...). Revoked on unload. */
    url(p) {
      const n = pathOf(p);
      if (!urlCache.has(n)) {
        urlCache.set(n, mod.zip.bytes(n).then(bytes => {
          const url = URL.createObjectURL(new Blob([bytes], { type: MIME[n.split('.').pop().toLowerCase()] ?? 'application/octet-stream' }));
          mod.blobUrls.add(url);
          return url;
        }));
      }
      return urlCache.get(n);
    },
    /** THREE.Texture from a file of the zip. */
    async texture(p, opts) {
      const url = await assets.url(p);
      mod.textureUrls.add(url);
      return Assets.texture(url, opts);
    },
  };

  /** A texture field is a zip path (preferred) or any URL. Resolves to a loaded URL. */
  const textureUrl = async tex => {
    if (typeof tex !== 'string' || !tex) throw new Error(`[${modId}] nextbot needs a texture`);
    const url = assets.has(tex) ? await assets.url(tex) : tex;
    if (url.startsWith('blob:')) mod.textureUrls.add(url);
    await Assets.texture(url);
    return url;
  };

  /* ---------- registries ---------- */
  const fullId = id => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`[${modId}] invalid id "${id}"`);
    return `${modId}:${id}`;
  };
  const register = (registry, def, extra = {}) => {
    const full = { order: CONFIG.mods.orderBase, ...def, ...extra, id: fullId(def.id), modId };
    registry.register(full);
    own(() => registry.unregister(full.id));
    return full;
  };
  const resolve = (registry, id) => (registry.has(`${modId}:${id}`) ? `${modId}:${id}` : id);

  const nextbots = {
    /** Async: waits for the texture. Returns the registered definition (id = "<modId>:<id>"). */
    register(def) {
      const job = (async () => {
        const texture = await textureUrl(def.texture);
        const full = register(NextbotRegistry, { ...CONFIG.mods.defaults.nextbot, ...def }, { texture });
        own(() => forgetNextbotMaterial(full.id));
        return full;
      })();
      mod.pending.push(job);
      return job;
    },
  };
  const props = { register: def => register(PropRegistry, { ...CONFIG.mods.defaults.prop, ...def }) };
  const spawnTabs = { register: def => register(SpawnTabRegistry, def) };
  const maps = { register: def => register(MapRegistry, def) };
  const menu = {
    addButton(def) {
      if (typeof def.onClick !== 'function') throw new Error(`[${modId}] menu button needs onClick`);
      return register(MenuButtonRegistry, { where: 'main', ...def, id: def.id ?? `btn${mod.disposers.length}`, onClick: () => guard(() => def.onClick()) });
    },
  };

  /* ---------- events ---------- */
  const on = (name, fn) => {
    if (name === 'ready' && host.game) {
      let live = true;
      queueMicrotask(() => { if (live) guard(() => fn(host.game)); });
      return own(() => { live = false; });
    }
    const off = events.on(`game:${name}`, payload => guard(() => fn(payload)));
    own(off);
    return off;
  };
  const bus = {
    on(name, fn) { const off = events.on(`mod:${name}`, p => guard(() => fn(p))); own(off); return off; },
    emit: (name, payload) => events.emit(`mod:${name}`, payload),
  };

  /* ---------- settings / storage / config ---------- */
  const sid = id => `mod.${modId}.${id}`;
  const settings = {
    define(def) {
      Settings.define({ category: mod.manifest.name, ...def, id: sid(def.id) });
      own(() => Settings.undefine(sid(def.id)));
    },
    get: id => Settings.get(sid(id)),
    set: (id, value) => Settings.set(sid(id), value),
    onChange(fn) {
      const off = Settings.events.on('change', ({ id, value }) => { if (id.startsWith(sid(''))) guard(() => fn({ id: id.slice(sid('').length), value })); });
      own(off);
      return off;
    },
  };
  const skey = k => `${CONFIG.mods.storagePrefix}${modId}.${k}`;
  const storage = {
    get(k, fallback = null) {
      try { const v = localStorage.getItem(skey(k)); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(skey(k), JSON.stringify(v)); } catch { /* storage full or unavailable */ } },
    remove(k) { try { localStorage.removeItem(skey(k)); } catch { /* unavailable */ } },
  };
  const walk = path => {
    const keys = path.split('.');
    const last = keys.pop();
    let o = CONFIG;
    for (const k of keys) { o = o?.[k]; if (o == null || typeof o !== 'object') throw new Error(`[${modId}] unknown config path "${path}"`); }
    if (!(last in o)) throw new Error(`[${modId}] unknown config path "${path}"`);
    return [o, last];
  };
  const config = {
    get: path => { const [o, k] = walk(path); return o[k]; },
    /** Changes CONFIG live. The original value is restored when the mod unloads. */
    set(path, value) {
      const [o, k] = walk(path);
      if (!mod.configBackup.has(path)) {
        mod.configBackup.set(path, o[k]);
        own(() => { o[k] = mod.configBackup.get(path); mod.configBackup.delete(path); });
      }
      o[k] = value;
    },
  };

  /* ---------- ui ---------- */
  const mountIn = (parent, node) => { parent.append(node); own(() => node.remove()); return node; };
  const ui = {
    el, Button, Panel, Tabs, Card, SettingControl, toast,
    /** Adds a node to the UI layer (always visible; set pointer-events:auto on interactive parts). */
    mount: node => mountIn(document.getElementById('ui-root'), node),
    /** Adds a node to the in-game HUD layer (only visible while playing). */
    mountHud: node => mountIn(needGame().hud.root, node),
  };
  const cursor = {
    /** Frees the mouse (leaves pointer lock) without opening the pause menu. Call the returned function to lock again. */
    free() {
      const release = needGame().freeCursor();
      return own(release);
    },
  };

  /* ---------- entities / spawning ---------- */
  const entities = {
    add(e) { needGame().world.add(e); mod.entities.add(e); return e; },
    remove(e) { mod.entities.delete(e); host.game?.world.remove(e); },
  };
  const spawn = {
    nextbot(id, point) { const g = needGame(); g.spawnNextbot(resolve(NextbotRegistry, id), point ?? g.aimPoint()); },
    prop(id, point) { const g = needGame(); g.spawnProp(resolve(PropRegistry, id), point ?? g.aimPoint()); },
    aimPoint: () => needGame().aimPoint(),
  };

  const api = {
    id: modId,
    manifest: Object.freeze({ ...mod.manifest }),
    apiVersion: CONFIG.mods.apiVersion,
    THREE,
    CONFIG,
    log,
    on,
    bus,
    onUnload: fn => own(() => guard(fn)),
    import: spec => import(spec),
    classes: { Entity, Nextbot, Prop },
    assets, nextbots, props, spawnTabs, maps, menu, settings, storage, config, ui, cursor, entities, spawn,
    get game() { return host.game; },
    get world() { return host.game?.world ?? null; },
    get scene() { return host.game?.world.scene ?? null; },
    get player() { return host.game?.player ?? null; },
    get camera() { return host.game?.camera ?? null; },
    get renderer() { return host.game?.renderer ?? null; },
    get input() { return host.game?.input ?? null; },
    get hud() { return host.game?.hud ?? null; },
    get ready() { mod.touchReady?.(); return host.readyPromise; },
  };
  return api;
}
