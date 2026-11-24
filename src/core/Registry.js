/** Generic id -> definition registry. Content (nextbots, props, spawn tabs) registers itself here. */
export class Registry {
  constructor(kind) { this.kind = kind; this._items = new Map(); this._subs = new Set(); }
  /** fn() runs after every register/unregister. Returns an unsubscribe function. */
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _changed() { for (const fn of [...this._subs]) fn(); }
  register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error(`[${this.kind}] definition needs a string id`);
    if (this._items.has(def.id)) throw new Error(`[${this.kind}] duplicate id "${def.id}"`);
    this._items.set(def.id, def);
    this._changed();
    return def;
  }
  unregister(id) {
    if (this._items.delete(id)) this._changed();
  }
  has(id) { return this._items.has(id); }
  get(id) {
    const d = this._items.get(id);
    if (!d) throw new Error(`[${this.kind}] unknown id "${id}"`);
    return d;
  }
  /** Sorted by optional numeric `order`, then insertion order. */
  all() {
    return [...this._items.values()]
      .map((d, i) => [d, i])
      .sort((a, b) => (a[0].order ?? 1e6) - (b[0].order ?? 1e6) || a[1] - b[1])
      .map(x => x[0]);
  }
}
