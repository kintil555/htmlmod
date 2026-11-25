import { CONFIG } from '../config.js';
import { STR } from '../content/strings.js';
import { Events, events } from '../core/Events.js';
import { Assets } from '../core/Assets.js';
import { toast } from '../ui/ui.js';
import { ZipReader, ZipError } from './Zip.js';
import { ModError, parseManifest, zipErrorKey, isOutdated } from './Manifest.js';
import { ModStore } from './ModStore.js';
import { createModAPI } from './ModAPI.js';
import { loadModule } from './Modules.js';
import { mountHtml } from './HtmlMod.js';

const LIMITS = { maxEntries: CONFIG.mods.maxEntries, maxUnpackedBytes: CONFIG.mods.maxUnpackedBytes };

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new ModError('timeout')), ms);
  promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

async function openZip(blob) {
  try { return await ZipReader.fromBlob(blob, LIMITS); } catch (err) {
    throw err instanceof ZipError ? zipErrorKey(err) : err;
  }
}

/** SHA-256 (hex) over the first and last CONFIG.net.modHashBytes of a blob: enough to tell two builds of a mod apart without reading a multi-GB ZIP. */
async function hashBlob(blob) {
  const n = CONFIG.net.modHashBytes;
  const head = new Uint8Array(await blob.slice(0, n).arrayBuffer());
  const tail = blob.size > n ? new Uint8Array(await blob.slice(Math.max(n, blob.size - n)).arrayBuffer()) : new Uint8Array(0);
  const all = new Uint8Array(head.length + tail.length);
  all.set(head);
  all.set(tail, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

/** Human readable error text from a ModError / ZipError / anything. */
export function describeError(err) {
  if (err instanceof ZipError) err = zipErrorKey(err);
  if (err instanceof ModError) {
    const m = STR.mods.err[err.key];
    return typeof m === 'function' ? m(err.arg) : m ?? err.key;
  }
  return err?.message ?? String(err);
}

/**
 * Mod host. A mod is a ZIP (mod.json + HTML/JS). Records live in IndexedDB; enabled mods are loaded at start
 * (before the game boots, so they can add nextbots/props) and can be installed, toggled and removed at runtime.
 * State per mod: { id, record, runtime, status: 'loaded'|'disabled'|'error'|'skipped', error }.
 */
class ModHost {
  constructor() {
    this.events = new Events();
    this.states = new Map();
    this.game = null;
    this._hashes = new WeakMap();
    this.readyPromise = new Promise(resolve => { this._ready = resolve; });
  }

  async init() {
    const skip = new URLSearchParams(location.search).has(CONFIG.mods.skipParam);
    const records = (await ModStore.all()).sort((a, b) => a.installedAt - b.installedAt);
    for (const record of records) {
      const state = { id: record.id, record, runtime: null, status: 'disabled', error: null };
      this.states.set(record.id, state);
      if (!record.enabled) continue;
      if (skip) state.status = 'skipped'; else await this._load(state);
    }
    this.events.emit('change');
  }

  /** Called once the game finished booting: mods get their 'ready' event. */
  attach(game) {
    this.game = game;
    this._ready(game);
    this.warnOutdated();
    events.emit('game:ready', game);
  }

  /** Toasts the names of enabled mods built for an older mod API. Returns them. */
  warnOutdated(only = this.list()) {
    const names = only.filter(m => m.outdated && m.enabled && m.status !== 'skipped').map(m => m.name);
    if (names.length) toast(STR.mods.outdatedToast(names));
    return names;
  }

  list() {
    return [...this.states.values()].map(s => ({
      id: s.id, ...s.record.manifest, outdated: isOutdated(s.record.manifest.api), enabled: s.record.enabled, status: s.status, error: s.error ? describeError(s.error) : '',
    }));
  }

  /**
   * Fingerprint of the mods that are enabled and running: [{ id, version, size, hash }] sorted by id.
   * Multiplayer compares it so host and guests run the same mods. hash = SHA-256 of the ZIP's head + tail (cached per ZIP).
   */
  async signature() {
    const out = [];
    for (const s of this.states.values()) {
      if (!s.record.enabled || s.status !== 'loaded') continue;
      const zip = s.record.zip;
      if (!this._hashes.has(zip)) this._hashes.set(zip, await hashBlob(zip));
      out.push({ id: s.id, version: s.record.manifest.version, size: zip.size, hash: this._hashes.get(zip) });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Installs (or updates) a mod from a ZIP File/Blob and loads it. Throws on an invalid ZIP/manifest. */
  async install(file) {
    if (file.size > CONFIG.mods.maxZipBytes) throw new ModError('zipTooBig');
    const zip = file.slice(0, file.size, 'application/zip'); // a view on the file: nothing is copied into memory
    const manifest = await parseManifest(await openZip(zip), file.name ?? 'mod');
    const prev = this.states.get(manifest.id);
    if (prev) this._unload(prev);
    const record = { id: manifest.id, manifest, enabled: true, installedAt: prev?.record.installedAt ?? Date.now(), zip };
    await ModStore.put(record);
    const state = prev ?? { id: manifest.id, runtime: null };
    Object.assign(state, { record, status: 'disabled', error: null });
    this.states.set(state.id, state);
    await this._load(state);
    const info = this.list().find(m => m.id === state.id);
    this.warnOutdated([info]);
    return info;
  }

  async setEnabled(id, enabled) {
    const state = this.states.get(id);
    if (!state) return;
    state.record.enabled = enabled;
    await ModStore.put(state.record);
    if (enabled) await this._load(state);
    else { this._unload(state); state.status = 'disabled'; state.error = null; }
    this.events.emit('change');
  }

  async remove(id) {
    const state = this.states.get(id);
    if (!state) return;
    this._unload(state);
    this.states.delete(id);
    await ModStore.delete(id);
    const prefix = `${CONFIG.mods.storagePrefix}${id}.`;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k); } catch { /* unavailable */ }
    this.events.emit('change');
  }

  /** A mod callback threw. Logs it; a mod that keeps failing is unloaded. */
  runtimeError(mod, err) {
    console.error(`[mod:${mod.id}]`, err);
    if (mod.dead || ++mod.errors <= CONFIG.mods.maxRuntimeErrors) return;
    const state = this.states.get(mod.id);
    toast(STR.mods.autoDisabled(mod.manifest.name));
    if (state) this.setEnabled(mod.id, false);
  }

  async _load(state) {
    const { record } = state;
    const mod = {
      id: record.id, manifest: record.manifest, zip: null, dead: false, errors: 0,
      disposers: [], blobUrls: new Set(), textureUrls: new Set(), entities: new Set(), pending: [], configBackup: new Map(),
    };
    state.runtime = mod;
    const T = CONFIG.mods.loadTimeoutMs;
    const fail = err => {
      console.error(`[mod:${record.id}]`, err);
      this._unload(state);
      state.status = 'error';
      state.error = err;
    };
    try {
      mod.zip = await openZip(record.zip);
      // A mod that waits for `api.ready` inside its init cannot finish before the game boots, and the game boots only after
      // all mods started. So the moment it touches `api.ready` the boot is released and the mod finishes in the background.
      const touched = new Promise(resolve => { mod.touchReady = () => resolve('ready'); });
      const api = createModAPI(this, mod);
      const done = this._run(mod, api).then(() => Promise.all(mod.pending)).then(() => 'done');
      if (await withTimeout(Promise.race([done, touched]), T) === 'ready') {
        state.status = 'loading';
        this.readyPromise.then(() => withTimeout(done, T)).then(() => { state.status = 'loaded'; state.error = null; }, fail).finally(() => this.events.emit('change'));
      } else {
        await withTimeout(done, T);
        state.status = 'loaded';
        state.error = null;
      }
    } catch (err) {
      fail(err);
    }
    this.events.emit('change');
  }

  async _run(mod, api) {
    const track = url => mod.blobUrls.add(url);
    const { main, html } = mod.manifest;
    if (main) {
      const ns = await loadModule(mod.zip, main, track);
      const init = ns.default ?? ns.init;
      if (typeof init !== 'function') throw new ModError('noEntryExport');
      await init(api);
      if (typeof ns.unload === 'function') api.onUnload(ns.unload);
    }
    if (html) await mountHtml(mod, api, track);
  }

  /** Undoes everything a mod did: entities, registrations, listeners, DOM, config changes, textures, blob URLs. */
  _unload(state) {
    const mod = state.runtime;
    if (!mod) return;
    mod.dead = true;
    const world = this.game?.world;
    if (world) {
      for (const e of mod.entities) world.remove(e);
      for (const e of [...world.entities]) if (e.def?.modId === mod.id) world.remove(e);
      this.game.spawnMenu?.updateCounts();
    }
    for (const dispose of mod.disposers.reverse()) {
      try { dispose(); } catch (err) { console.error(`[mod:${mod.id}] unload`, err); }
    }
    mod.disposers.length = 0;
    for (const url of mod.textureUrls) Assets.release(url);
    for (const url of mod.blobUrls) URL.revokeObjectURL(url);
    state.runtime = null;
  }
}

export const Mods = new ModHost();
