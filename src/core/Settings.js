import { Events } from './Events.js';

const KEY = 'sandbox.settings.v1';

/**
 * Settings library. The Settings screen renders itself from definitions.
 * Add an option:  Settings.define({ id:'volume', label:'Volume', type:'slider', min:0, max:1, step:0.05, default:0.8, category:'Audio' })
 * types: 'toggle' | 'slider' | 'select' (select needs options:[{value,label}]) | 'text' (optional maxLength)
 * Read it:        Settings.get('volume')   React: Settings.events.on('change', ({id,value}) => ...)
 */
class SettingsStore {
  constructor() {
    this.events = new Events();
    this._defs = new Map();
    this._values = {};
    try { this._values = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { this._values = {}; }
  }
  define(def) {
    if (!def?.id || !def.type) throw new Error('Setting needs id and type');
    if (this._defs.has(def.id)) throw new Error(`Duplicate setting "${def.id}"`);
    this._defs.set(def.id, def);
  }
  /** Removes a definition (used by mods on unload). The stored value is kept. */
  undefine(id) { this._defs.delete(id); }
  all() { return [...this._defs.values()]; }
  /** True once the player (or code) stored a value for this setting. */
  isSet(id) { return id in this._values; }
  get(id) {
    const d = this._defs.get(id);
    if (!d) throw new Error(`Unknown setting "${id}"`);
    return id in this._values ? this._values[id] : d.default;
  }
  set(id, value) {
    if (!this._defs.has(id)) throw new Error(`Unknown setting "${id}"`);
    this._values[id] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this._values)); } catch { /* storage unavailable */ }
    this.events.emit('change', { id, value });
  }
}
export const Settings = new SettingsStore();
